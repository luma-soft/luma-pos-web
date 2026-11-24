import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";
import { readKiotVietDataBundle } from "../lib/kiotviet/data-sync-files";
import { normalizeKiotVietNumber, normalizeKiotVietText } from "../lib/kiotviet/data-sync-plan";
import { filterKiotVietExport } from "../lib/kiotviet/export-filter";
import { selectNewestKiotVietFilename } from "../lib/kiotviet/product-sync-files";
import { runKiotVietLinkDocuments } from "./kiotviet-link-documents";
import { runKiotVietPosCodes } from "./kiotviet-pos-codes";
import { runKiotVietDataSyncCli } from "./sync-kiotviet-data";

/**
 * One KiotViet → Luma POS sync from a folder of KiotViet exports.
 *
 *   bun run src/scripts/kiotviet-sync-run.ts <export-dir> --store=hai-dang \
 *     --reviewed-customer-totals=DEBT:NET --reviewed-supplier-totals=DEBT:NET \
 *     [--apply] [--only=purchases,sales] [--report=<file.md>]
 *
 * --only limits which importer phases are written (the plan still covers all).
 * Customer and supplier phases set balances to the export, so use them only
 * with an export taken just before the run.
 *
 * Rules:
 * - Luma POS keeps its own codes; KiotViet codes live only in source mappings.
 * - Documents POS already recorded are linked, not created again; look-alikes
 *   are held for review.
 * - Only documents missing from POS are created; matched documents are never
 *   rewritten.
 * - Discontinued KiotViet products ("Đang kinh doanh" = 0) are never created.
 *   New active products are listed for creation through the POS product API
 *   (they get POS SKUs), then linked with kiotviet-pos-codes --map-product.
 * - A "new" KiotViet product that matches exactly one unmapped POS product by
 *   name and unit is linked to it instead (with --apply); look-alikes that are
 *   ambiguous are held for review. POS products are never created twice.
 */

const DOCUMENT_PHASES = [
  { phase: "sales", prefix: "DanhSachChiTietHoaDon", code: "Mã hóa đơn" },
  { phase: "purchases", prefix: "DanhSachChiTietNhapHang", code: "Mã nhập hàng" },
  { phase: "returns", prefix: "DanhSachChiTietTraHang", code: "Mã trả hàng", exclude: "DanhSachChiTietTraHangNhap" },
  { phase: "purchase-returns", prefix: "DanhSachChiTietTraHangNhap", code: "Mã trả hàng nhập" },
] as const;
const MASTER_PREFIXES = ["DanhSachKhachHang", "DanhSachNhaCungCap", "DanhSachChiTietDatHang"];
const APPLY_ORDER = ["customers", "suppliers", "bookings", "sales", "purchases", "returns", "purchase-returns"] as const;
const MANAGED_KEYS = [
  "created", "creates", "adopted", "adopts", "updated", "updates", "inactivated", "historicalPlaceholders",
  "unknownSupplierPlaceholders", "debtCorrections", "totalSpentCorrections", "parentStatusUpdates",
  "subtotalRepairs", "settlementStatusRepairs",
];

type ProductRow = Record<string, unknown>;
export interface NewProduct {
  kiotvietSku: string; name: string; baseUnit: string; costPrice: number; retailPrice: number;
  category: string; brand: string | null; barcode: string | null;
}

const text = (value: unknown) => normalizeKiotVietText(value);
const isActive = (row: ProductRow) => text(row["Đang kinh doanh"]) !== "0";

export interface PosProductCandidate { sku: string; name: string; baseUnit: string }
export interface ExistingProductMatches {
  /** KiotViet SKU → POS SKU of the one unmapped POS product with the same name and unit. */
  links: Map<string, string>;
  /** KiotViet products that look like several POS products, or carry attributes; never created or linked. */
  held: Array<{ kiotvietSku: string; reason: string; candidates: string[] }>;
}

const productNameKey = (name: string) => name.normalize("NFC").toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();
const unitKey = (unit: string) => unit.normalize("NFC").toLocaleLowerCase("vi").trim();

/**
 * Finds POS products a "new" KiotViet product already is. A product created in
 * POS and later keyed into KiotViet has no mapping yet, so without this check
 * the runbook would create it a second time (the 2026-10/11 duplicates).
 *
 * A link needs exactly one unmapped POS product with the same name and unit,
 * and the name must be unique among the new KiotViet products. Products with
 * KiotViet attributes (size, mã…) or several look-alikes are held for review.
 */
export function matchExistingPosProducts(
  newProducts: Array<Pick<NewProduct, "kiotvietSku" | "name" | "baseUnit"> & { hasAttributes?: boolean }>,
  unmappedPosProducts: PosProductCandidate[],
): ExistingProductMatches {
  const posByName = new Map<string, PosProductCandidate[]>();
  for (const product of unmappedPosProducts) {
    const key = productNameKey(product.name);
    posByName.set(key, [...(posByName.get(key) ?? []), product]);
  }
  const kvNameCount = new Map<string, number>();
  for (const product of newProducts) {
    const key = productNameKey(product.name);
    kvNameCount.set(key, (kvNameCount.get(key) ?? 0) + 1);
  }
  const links = new Map<string, string>();
  const held: ExistingProductMatches["held"] = [];
  const claimed = new Set<string>();
  for (const product of newProducts) {
    const key = productNameKey(product.name);
    const sameName = posByName.get(key) ?? [];
    if (sameName.length === 0) continue;
    const candidates = sameName.map((item) => item.sku);
    const sameUnit = sameName.filter((item) => unitKey(item.baseUnit) === unitKey(product.baseUnit));
    if (product.hasAttributes) held.push({ kiotvietSku: product.kiotvietSku, reason: "sản phẩm KiotViet có thuộc tính, POS có sản phẩm cùng tên", candidates });
    else if ((kvNameCount.get(key) ?? 0) > 1) held.push({ kiotvietSku: product.kiotvietSku, reason: "nhiều sản phẩm KiotViet mới cùng tên", candidates });
    else if (sameUnit.length !== 1) held.push({ kiotvietSku: product.kiotvietSku, reason: sameUnit.length === 0 ? "POS có sản phẩm cùng tên nhưng khác ĐVT" : "POS có nhiều sản phẩm cùng tên", candidates });
    else if (claimed.has(sameUnit[0]!.sku)) held.push({ kiotvietSku: product.kiotvietSku, reason: "sản phẩm POS cùng tên đã được nối", candidates });
    else {
      claimed.add(sameUnit[0]!.sku);
      links.set(product.kiotvietSku, sameUnit[0]!.sku);
    }
  }
  return { links, held };
}

export async function runKiotVietSync(argv: string[]) {
  const directory = argv.find((argument) => !argument.startsWith("--"));
  if (!directory) throw new Error("Pass the folder that holds the KiotViet exports");
  const apply = argv.includes("--apply");
  const store = argv.find((argument) => argument.startsWith("--store="));
  if (store !== "--store=hai-dang") throw new Error("--store=hai-dang is required");
  const totals = argv.filter((argument) => argument.startsWith("--reviewed-"));
  const reportPath = argv.find((argument) => argument.startsWith("--report="))?.slice("--report=".length)
    ?? join(process.cwd(), `kiotviet-sync-report-${new Date().toISOString().slice(0, 10)}.md`);
  const onlyArg = argv.find((argument) => argument.startsWith("--only="))?.slice("--only=".length);
  const only = onlyArg ? new Set(onlyArg.split(",").map((part) => part.trim()).filter(Boolean)) : null;
  for (const phase of only ?? []) {
    if (!(APPLY_ORDER as readonly string[]).includes(phase)) throw new Error(`Unknown phase in --only: ${phase}`);
  }
  const writes = (phase: string) => !only || only.has(phase);
  if (apply && ((writes("customers") && !totals.some((item) => item.startsWith("--reviewed-customer-totals=")))
    || (writes("suppliers") && !totals.some((item) => item.startsWith("--reviewed-supplier-totals="))))) {
    throw new Error("--apply of customers/suppliers needs --reviewed-customer-totals / --reviewed-supplier-totals read off KiotViet");
  }

  // Validates every workbook (headers, totals per document) before anything is written.
  const bundle = readKiotVietDataBundle(directory);
  const productFile = selectNewestKiotVietFilename(readdirSync(directory), "DanhSachSanPham");
  if (!productFile) throw new Error("The export folder needs the product list (DanhSachSanPham_KV*.xlsx)");
  const productWorkbook = XLSX.read(readFileSync(join(directory, productFile)), { cellDates: false });
  const productRows = XLSX.utils.sheet_to_json<ProductRow>(productWorkbook.Sheets[productWorkbook.SheetNames[0]!]!, { defval: null });
  const kvProducts = new Map(productRows.map((row) => [text(row["Mã hàng"]), row]));

  // 1. Link documents POS already has.
  const links = await runKiotVietLinkDocuments([directory, "--store=hai-dang", ...(apply ? ["--apply"] : [])]);
  const keep = new Map<string, Set<string>>();
  const held: Array<{ phase: string; code: string; reason: string; detail: string }> = [];
  for (const { phase, result } of links.report) {
    keep.set(phase, new Set(result.unmatched.map((item) => item.code)));
    for (const item of result.held) {
      held.push({ phase, code: item.source.code, reason: item.reason, detail: item.candidates.map((candidate) => `${candidate.code} ${candidate.amount}`).join(", ") });
    }
  }

  // 2. Products: never create discontinued ones; list new active ones.
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { and, eq, inArray, isNull } = await import("drizzle-orm");
  const [storeRow] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.slug, "hai-dang")).limit(1);
  const storeId = storeRow!.id;
  const posSkus = new Set((await db.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.storeId, storeId))).map((row) => row.sku));
  const mappedSkus = new Set((await db.select({ externalId: schema.productSourceMappings.externalId }).from(schema.productSourceMappings)
    .where(and(eq(schema.productSourceMappings.storeId, storeId), eq(schema.productSourceMappings.provider, "kiotviet"), isNull(schema.productSourceMappings.deletedAt))))
    .map((row) => row.externalId));
  const unitSkus = new Set((await db.select({ sku: schema.productUnits.sku }).from(schema.productUnits).where(eq(schema.productUnits.storeId, storeId)))
    .flatMap((row) => (row.sku ? [row.sku] : [])));
  const inPos = (sku: string) => posSkus.has(sku) || mappedSkus.has(sku) || unitSkus.has(sku);

  const newProducts: NewProduct[] = [];
  const unitsReady: string[] = [];
  const unitsWaiting: string[] = [];
  const skippedDiscontinued: string[] = [];
  for (const [sku, row] of kvProducts) {
    if (!sku || inPos(sku)) continue;
    if (!isActive(row)) { skippedDiscontinued.push(`${sku} ${text(row["Tên hàng"])}`); continue; }
    if (text(row["Loại hàng"]).toLocaleLowerCase("vi").includes("dịch vụ")) continue;
    const baseSku = text(row["Mã ĐVT Cơ bản"]);
    if (baseSku) {
      (inPos(baseSku) ? unitsReady : unitsWaiting).push(sku);
      continue;
    }
    const [category] = text(row["Nhóm hàng(3 Cấp)"]).split(">>").map((part) => part.trim()).filter(Boolean).slice(-1);
    newProducts.push({
      kiotvietSku: sku, name: text(row["Tên hàng"]), baseUnit: text(row["ĐVT"]) || "cái",
      costPrice: normalizeKiotVietNumber(row["Giá vốn"]),
      retailPrice: normalizeKiotVietNumber(row["Giá bán trước thuế"] ?? row["Giá bán"]),
      category: category ?? "", brand: text(row["Thương hiệu"]) || null, barcode: text(row["Mã vạch"]) || null,
    });
  }
  // 2b. A "new" KiotViet product may be one POS created first: link it, never create a twin.
  const mappedProductIds = new Set((await db.select({ productId: schema.productSourceMappings.productId }).from(schema.productSourceMappings)
    .where(and(eq(schema.productSourceMappings.storeId, storeId), eq(schema.productSourceMappings.provider, "kiotviet"))))
    .map((row) => row.productId));
  const unmappedPosProducts = (await db.select({
    id: schema.products.id, sku: schema.products.sku, name: schema.products.name, baseUnit: schema.products.baseUnit,
  }).from(schema.products).where(and(
    eq(schema.products.storeId, storeId),
    inArray(schema.products.lifecycleStatus, ["active", "draft"]),
    eq(schema.products.isVariantParent, false),
  ))).filter((product) => !mappedProductIds.has(product.id));
  const existing = matchExistingPosProducts(
    newProducts.map((item) => ({ ...item, hasAttributes: text(kvProducts.get(item.kiotvietSku)?.["Thuộc tính"]) !== "" })),
    unmappedPosProducts,
  );
  const linkedExisting = [...existing.links].map(([kiotvietSku, posSku]) => ({ kiotvietSku, posSku, name: text(kvProducts.get(kiotvietSku)?.["Tên hàng"]) }));
  const heldProducts = existing.held.map((item) => ({ ...item, name: text(kvProducts.get(item.kiotvietSku)?.["Tên hàng"]) }));
  const notNew = new Set([...existing.links.keys(), ...existing.held.map((item) => item.kiotvietSku)]);
  newProducts.splice(0, newProducts.length, ...newProducts.filter((item) => !notNew.has(item.kiotvietSku)));
  if (apply && linkedExisting.length > 0) {
    await runKiotVietPosCodes(["--store=hai-dang", ...linkedExisting.map((item) => `--map-product=${item.kiotvietSku}=${item.posSku}`), "--apply"]);
    for (const item of linkedExisting) mappedSkus.add(item.kiotvietSku);
  }
  const willLink = new Set(linkedExisting.map((item) => item.kiotvietSku));

  if (apply && unitsReady.length > 0) {
    await runKiotVietPosCodes(["--store=hai-dang", `--units-from=${join(directory, productFile)}`, ...unitsReady.map((sku) => `--unit=${sku}`), "--apply"]);
    for (const sku of unitsReady) unitSkus.add(sku);
  }

  // 3. Hold documents whose products are discontinued or not created yet.
  const waiting = new Set([...newProducts.map((item) => item.kiotvietSku), ...unitsWaiting]);
  for (const definition of DOCUMENT_PHASES) {
    const workbook = bundle.sources.find((item) => item.phase === definition.phase)!;
    const kept = keep.get(definition.phase)!;
    for (const row of workbook.rows) {
      const code = text(row[definition.code]);
      const sku = text(row["Mã hàng"]);
      if (!kept.has(code) || !sku || inPos(sku) || (!apply && (unitsReady.includes(sku) || willLink.has(sku)))) continue;
      const product = kvProducts.get(sku);
      const reason = !product ? "sản phẩm không có trong danh sách KiotViet"
        : !isActive(product) ? "sản phẩm đã ngừng kinh doanh (không tạo trong POS)"
          : notNew.has(sku) ? "sản phẩm giống sản phẩm POS có sẵn, chờ duyệt nối"
            : waiting.has(sku) ? "chờ tạo sản phẩm mới trong POS" : "sản phẩm chưa khớp";
      kept.delete(code);
      held.push({ phase: definition.phase, code, reason, detail: `${sku} ${product ? text(product["Tên hàng"]) : ""}`.trim() });
    }
  }

  // 4. Stage only what POS is missing, then plan.
  const stage = mkdtempSync(join(tmpdir(), "kiotviet-stage-"));
  const files = readdirSync(directory);
  for (const prefix of MASTER_PREFIXES) {
    const file = selectNewestKiotVietFilename(files, prefix);
    if (!file) throw new Error(`Missing ${prefix}_KV*.xlsx`);
    copyFileSync(join(directory, file), join(stage, file));
  }
  for (const definition of DOCUMENT_PHASES) {
    const file = selectNewestKiotVietFilename(files, definition.prefix, "exclude" in definition ? definition.exclude : undefined)!;
    filterKiotVietExport({ sourcePath: join(directory, file), targetPath: join(stage, file), codeColumn: definition.code, keep: keep.get(definition.phase)! });
  }
  const dryRun = await runKiotVietDataSyncCli([stage, "--store=hai-dang", "--phase=all"]);
  const plans = dryRun.report.plans as Array<{ phase: string; summary: Record<string, number>; blockers: Array<{ reason: string; count: number }> }>;
  const blockers = dryRun.report.blockers as Array<{ phase: string; reason: string; count: number }>;
  const changesFor = (phase: string) => {
    const summary = plans.find((plan) => plan.phase === phase)?.summary ?? {};
    return MANAGED_KEYS.reduce((sum, key) => sum + (summary[key] ?? 0), 0);
  };

  // 5. Apply phase by phase; each phase re-plans to zero after writing.
  const applied: Array<{ phase: string; summary: Record<string, number> }> = [];
  if (apply && blockers.length === 0) {
    for (const phase of APPLY_ORDER) {
      if (changesFor(phase) === 0 || !writes(phase)) continue;
      const source = dryRun.report.sources.find((item: { phase: string }) => item.phase === phase) as { sha256: string };
      const result = await runKiotVietDataSyncCli([stage, "--store=hai-dang", `--phase=${phase}`, "--apply", `--source-sha256=${source.sha256}`, ...totals]);
      applied.push({ phase, summary: (result.report.plans as typeof plans).find((plan) => plan.phase === phase)!.summary });
    }
  }

  const lines = [
    `# Đồng bộ KiotViet → Luma POS · ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
    "",
    `Chế độ: **${apply ? "ĐÃ GHI" : "chạy thử (không ghi)"}** · thư mục: \`${directory}\``,
    "",
    "## Chứng từ đã có trong POS (nối, không tạo lại)",
    ...links.report.map(({ phase, result }) => `- ${phase}: nối ${result.linked.length}`),
    "",
    "## Chứng từ còn thiếu sẽ tạo",
    ...DOCUMENT_PHASES.map((definition) => `- ${definition.phase}: ${[...keep.get(definition.phase)!].join(", ") || "—"}`),
    "",
    "## Giữ lại chờ duyệt (không tạo)",
    ...(held.length ? held.map((item) => `- ${item.phase} **${item.code}** — ${item.reason}${item.detail ? ` (${item.detail})` : ""}`) : ["- Không có"]),
    "",
    "## Sản phẩm",
    `- Nối với sản phẩm POS có sẵn (cùng tên, cùng ĐVT) ${apply ? "đã nối" : "sẽ nối"}: ${linkedExisting.length}`,
    ...linkedExisting.map((item) => `  - ${item.kiotvietSku} → ${item.posSku} · ${item.name}`),
    `- Giống sản phẩm POS có sẵn, chờ duyệt (không tạo, không nối): ${heldProducts.length}`,
    ...heldProducts.map((item) => `  - ${item.kiotvietSku} · ${item.name} — ${item.reason} (${item.candidates.join(", ")})`),
    `- Sản phẩm mới còn kinh doanh cần tạo trong POS: ${newProducts.length}`,
    ...newProducts.map((item) => `  - ${item.kiotvietSku} · ${item.name} · ${item.baseUnit} · giá vốn ${item.costPrice} · giá bán ${item.retailPrice} · nhóm ${item.category}${item.brand ? ` · ${item.brand}` : ""}`),
    `- ĐVT quy đổi ${apply ? "đã gắn" : "sẽ gắn"}: ${unitsReady.join(", ") || "—"}`,
    `- ĐVT chờ sản phẩm gốc: ${unitsWaiting.join(", ") || "—"}`,
    `- Bỏ qua vì ngừng kinh doanh: ${skippedDiscontinued.length}`,
    "",
    "## Importer",
    blockers.length ? `- DỪNG vì blocker: ${blockers.map((item) => `${item.phase}:${item.reason}=${item.count}`).join(", ")}` : "- Không có blocker",
    ...plans.filter((plan) => changesFor(plan.phase) > 0).map((plan) => `- ${plan.phase}: ${JSON.stringify(Object.fromEntries(Object.entries(plan.summary).filter(([key, value]) => value && MANAGED_KEYS.includes(key))))}`),
    ...(apply ? [`- Đã ghi: ${applied.map((item) => item.phase).join(", ") || "không có thay đổi"}`] : []),
  ];
  writeFileSync(reportPath, `${lines.join("\n")}\n`);
  writeFileSync(reportPath.replace(/\.md$/, ".json"), JSON.stringify({ apply, held, linkedExisting, heldProducts, newProducts, unitsReady, unitsWaiting, blockers, applied }, null, 2));
  return { reportPath, apply, held, newProducts, blockers, applied };
}

async function main() {
  const result = await runKiotVietSync(process.argv.slice(2));
  console.log(`${result.apply ? "APPLIED" : "DRY-RUN"} · report ${result.reportPath}`);
  console.log(`held ${result.held.length} · new products ${result.newProducts.length} · blockers ${result.blockers.length} · applied ${result.applied.map((item) => item.phase).join(",") || "-"}`);
  process.exit(result.blockers.length > 0 ? 2 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

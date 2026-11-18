import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { kiotVietPosCode, type KiotVietPosCodeEntity } from "../lib/kiotviet/pos-codes";

/**
 * Gives Luma POS codes to records that a KiotViet sync created with KiotViet
 * codes, and gives Luma POS SKUs to products created under a KiotViet SKU.
 *
 * The KiotViet identity is kept as the record's source mapping, so later syncs
 * still recognise the record and never create it twice.
 *
 *   bun run src/scripts/kiotviet-pos-codes.ts --store=hai-dang \
 *     --run=<kiotviet_sync_runs.id> [--run=...] [--product=SP053538 ...] \
 *     [--units-from=DanhSachSanPham_KV....xlsx --unit=SP053532 ...] [--apply]
 *
 * --map-product=SP053543=SPMW... links a KiotViet product SKU to a product
 * created in Luma POS (with its own POS SKU) for a new KiotViet product.
 *
 * --unit links a KiotViet alternate-unit SKU (Hộp, Viên…) to its base product.
 * Luma POS has no code of its own for a unit, so the KiotViet unit SKU is kept
 * on the unit; unit name, conversion and price come from the reviewed product
 * export given with --units-from.
 *
 * Without --apply it only prints the plan.
 */

const RECODABLE_ENTITIES = [
  "customer", "supplier", "booking", "sale", "purchase", "customer_return", "supplier_return",
] as const satisfies readonly KiotVietPosCodeEntity[];

export interface KiotVietPosCodeArgs {
  storeSlug: string;
  runIds: string[];
  productSkus: string[];
  unitSkus: string[];
  unitsFrom: string | null;
  productLinks: Array<{ externalId: string; posSku: string }>;
  apply: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseKiotVietPosCodeArgs(argv: string[]): KiotVietPosCodeArgs {
  let storeSlug = "";
  const runIds: string[] = [];
  const productSkus: string[] = [];
  const unitSkus: string[] = [];
  let unitsFrom: string | null = null;
  const productLinks: Array<{ externalId: string; posSku: string }> = [];
  let apply = false;
  for (const argument of argv) {
    if (argument === "--apply") apply = true;
    else if (argument.startsWith("--store=")) storeSlug = argument.slice("--store=".length).trim();
    else if (argument.startsWith("--run=")) {
      const runId = argument.slice("--run=".length).trim();
      if (!UUID.test(runId)) throw new Error(`--run expects a sync run UUID, received ${runId}`);
      runIds.push(runId);
    } else if (argument.startsWith("--product=")) {
      const sku = argument.slice("--product=".length).trim();
      if (!sku) throw new Error("--product expects a SKU");
      productSkus.push(sku);
    } else if (argument.startsWith("--unit=")) {
      const sku = argument.slice("--unit=".length).trim();
      if (!sku) throw new Error("--unit expects a KiotViet unit SKU");
      unitSkus.push(sku);
    } else if (argument.startsWith("--map-product=")) {
      const [externalId, posSku, extra] = argument.slice("--map-product=".length).split("=").map((part) => part.trim());
      if (!externalId || !posSku || extra !== undefined) throw new Error("--map-product expects KIOTVIET_SKU=POS_SKU");
      productLinks.push({ externalId, posSku });
    } else if (argument.startsWith("--units-from=")) {
      unitsFrom = argument.slice("--units-from=".length).trim() || null;
    } else throw new Error(`Unsupported option: ${argument}`);
  }
  if (storeSlug !== "hai-dang") throw new Error("--store=hai-dang is required");
  if (unitSkus.length > 0 && !unitsFrom) throw new Error("--unit requires --units-from=<KiotViet product export>");
  if (runIds.length === 0 && productSkus.length === 0 && unitSkus.length === 0 && productLinks.length === 0) {
    throw new Error("Nothing to do: pass --run, --product, --map-product and/or --unit");
  }
  return {
    storeSlug, runIds: [...new Set(runIds)], productSkus: [...new Set(productSkus)],
    unitSkus: [...new Set(unitSkus)], unitsFrom, productLinks, apply,
  };
}

/** Same shape as the POS product form's generated SKU. */
function posProductSku(): string {
  return `SP${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").slice(0, 3).toUpperCase()}`;
}

export async function runKiotVietPosCodes(argv: string[]) {
  const args = parseKiotVietPosCodeArgs(argv);
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { and, desc, eq, gte, inArray, isNull, lte } = await import("drizzle-orm");

  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(eq(schema.stores.slug, args.storeSlug)).limit(1);
  if (!store) throw new Error(`Store not found: ${args.storeSlug}`);
  const storeId = store.id;

  const tables = {
    customer: schema.customers, supplier: schema.suppliers, booking: schema.orders, sale: schema.orders,
    purchase: schema.purchaseOrders, customer_return: schema.returns, supplier_return: schema.purchaseReturns,
  } as const;

  type Change = {
    kind: "record"; entity: KiotVietPosCodeEntity; localId: string; externalId: string; from: string; to: string;
  } | {
    kind: "product"; productId: string; from: string; to: string;
  } | {
    kind: "product_link"; productId: string; externalId: string; posSku: string;
  } | {
    kind: "unit"; productId: string; baseSku: string; sku: string; unitName: string; multiplier: number;
    priceOverride: number | null; directSale: boolean; barcode: string | null;
  };

  return db.transaction(async (tx) => {
    const changes: Change[] = [];
    const reserved = new Set<string>();

    for (const runId of args.runIds) {
      const [run] = await tx.select({
        id: schema.kiotvietSyncRuns.id, status: schema.kiotvietSyncRuns.status,
        startedAt: schema.kiotvietSyncRuns.startedAt, completedAt: schema.kiotvietSyncRuns.completedAt,
      })
        .from(schema.kiotvietSyncRuns)
        .where(and(eq(schema.kiotvietSyncRuns.storeId, storeId), eq(schema.kiotvietSyncRuns.id, runId))).limit(1);
      if (!run) throw new Error(`Sync run ${runId} does not belong to ${args.storeSlug}`);
      if (run.status !== "completed" || !run.completedAt) throw new Error(`Sync run ${runId} is ${run.status}, not completed`);

      const mappings = await tx.select({
        entityType: schema.kiotvietSourceMappings.entityType,
        externalId: schema.kiotvietSourceMappings.externalId,
        localId: schema.kiotvietSourceMappings.localId,
        mappedAt: schema.kiotvietSourceMappings.createdAt,
      }).from(schema.kiotvietSourceMappings).where(and(
        eq(schema.kiotvietSourceMappings.storeId, storeId),
        eq(schema.kiotvietSourceMappings.provider, "kiotviet"),
        eq(schema.kiotvietSourceMappings.lastSeenRunId, runId),
        eq(schema.kiotvietSourceMappings.adoptionMethod, "created"),
        inArray(schema.kiotvietSourceMappings.entityType, [...RECODABLE_ENTITIES]),
        isNull(schema.kiotvietSourceMappings.deletedAt),
        // Created by this run, not merely seen again by it.
        gte(schema.kiotvietSourceMappings.createdAt, run.startedAt),
        lte(schema.kiotvietSourceMappings.createdAt, run.completedAt),
      ));

      for (const mapping of mappings) {
        const entity = mapping.entityType as KiotVietPosCodeEntity;
        const table = tables[entity];
        const [record] = await tx.select({ code: table.code, createdAt: table.createdAt }).from(table)
          .where(and(eq(table.storeId, storeId), eq(table.id, mapping.localId))).limit(1);
        if (!record) throw new Error(`Mapped ${entity} ${mapping.externalId} has no POS record`);
        // Only records still carrying their KiotViet code; reruns are no-ops.
        if (record.code !== mapping.externalId) continue;
        const at = entity === "customer" || entity === "supplier" ? mapping.mappedAt : record.createdAt;
        let code: string | null = null;
        for (let attempt = 0; attempt < 20 && !code; attempt += 1) {
          const candidate = kiotVietPosCode(entity, mapping.externalId, at, attempt);
          if (reserved.has(`${entity}:${candidate}`)) continue;
          const taken = await tx.select({ id: table.id }).from(table)
            .where(and(eq(table.storeId, storeId), eq(table.code, candidate))).limit(1);
          if (taken.length === 0) code = candidate;
        }
        if (!code) throw new Error(`Could not allocate a POS code for ${entity} ${mapping.externalId}`);
        reserved.add(`${entity}:${code}`);
        changes.push({ kind: "record", entity, localId: mapping.localId, externalId: mapping.externalId, from: record.code, to: code });
      }
    }

    for (const sku of args.productSkus) {
      const products = await tx.select({ id: schema.products.id, sku: schema.products.sku }).from(schema.products)
        .where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, sku)));
      const existingMapping = await tx.select({ productId: schema.productSourceMappings.productId })
        .from(schema.productSourceMappings).where(and(
          eq(schema.productSourceMappings.storeId, storeId),
          eq(schema.productSourceMappings.provider, "kiotviet"),
          eq(schema.productSourceMappings.externalId, sku),
        )).limit(1);
      if (products.length === 0 && existingMapping.length === 1) continue; // already recoded
      if (products.length !== 1) throw new Error(`Product ${sku} must match exactly one POS product`);
      const product = products[0]!;
      if (existingMapping.length > 0) throw new Error(`KiotViet product ${sku} is already mapped`);
      const productMapping = await tx.select({ externalId: schema.productSourceMappings.externalId })
        .from(schema.productSourceMappings).where(and(
          eq(schema.productSourceMappings.storeId, storeId),
          eq(schema.productSourceMappings.provider, "kiotviet"),
          eq(schema.productSourceMappings.productId, product.id),
        )).limit(1);
      if (productMapping.length > 0) throw new Error(`Product ${sku} already has KiotViet mapping ${productMapping[0]!.externalId}`);
      const unitClash = await tx.select({ id: schema.productUnits.id }).from(schema.productUnits)
        .where(and(eq(schema.productUnits.storeId, storeId), eq(schema.productUnits.sku, sku))).limit(1);
      if (unitClash.length > 0) throw new Error(`Product ${sku} is also an alternate unit SKU`);
      let next = posProductSku();
      while ((await tx.select({ id: schema.products.id }).from(schema.products)
        .where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, next))).limit(1)).length > 0) {
        next = posProductSku();
      }
      changes.push({ kind: "product", productId: product.id, from: sku, to: next });
    }

    for (const link of args.productLinks) {
      const [product] = await tx.select({ id: schema.products.id }).from(schema.products)
        .where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, link.posSku))).limit(2);
      if (!product) throw new Error(`POS product ${link.posSku} not found`);
      const existing = await tx.select({ productId: schema.productSourceMappings.productId, externalId: schema.productSourceMappings.externalId })
        .from(schema.productSourceMappings).where(and(
          eq(schema.productSourceMappings.storeId, storeId), eq(schema.productSourceMappings.provider, "kiotviet"),
        ));
      if (existing.some((item) => item.externalId === link.externalId && item.productId === product.id)) continue;
      if (existing.some((item) => item.externalId === link.externalId)) throw new Error(`KiotViet product ${link.externalId} is already mapped`);
      if (existing.some((item) => item.productId === product.id)) throw new Error(`POS product ${link.posSku} already has a KiotViet mapping`);
      const clash = await tx.select({ id: schema.products.id }).from(schema.products)
        .where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, link.externalId))).limit(1);
      const unitClash = await tx.select({ id: schema.productUnits.id }).from(schema.productUnits)
        .where(and(eq(schema.productUnits.storeId, storeId), eq(schema.productUnits.sku, link.externalId))).limit(1);
      if (clash.length > 0 || unitClash.length > 0) throw new Error(`KiotViet SKU ${link.externalId} is already used by another POS product or unit`);
      changes.push({ kind: "product_link", productId: product.id, externalId: link.externalId, posSku: link.posSku });
    }

    if (args.unitSkus.length > 0) {
      const XLSX = await import("xlsx");
      const { readFileSync } = await import("node:fs");
      const workbook = XLSX.read(readFileSync(args.unitsFrom!), { type: "buffer", cellDates: false });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]!]!, { defval: null });
      const text = (value: unknown) => (value == null ? "" : String(value).trim());
      const bySku = new Map(rows.map((row) => [text(row["Mã hàng"]), row]));
      const priceOf = (row: Record<string, unknown>) => Number(row["Giá bán trước thuế"] ?? row["Giá bán"] ?? 0);
      for (const sku of args.unitSkus) {
        const row = bySku.get(sku);
        if (!row) throw new Error(`Unit ${sku} is not in ${args.unitsFrom}`);
        const baseSku = text(row["Mã ĐVT Cơ bản"]);
        const baseRow = bySku.get(baseSku);
        if (!baseSku || !baseRow) throw new Error(`Unit ${sku} has no base product row in the export`);
        const multiplier = Number(row["Quy đổi"]);
        const unitName = text(row["ĐVT"]);
        if (!unitName || !Number.isFinite(multiplier) || multiplier <= 0) throw new Error(`Unit ${sku} has an invalid unit or conversion`);
        const existingUnit = await tx.select({ productId: schema.productUnits.productId, unitName: schema.productUnits.unitName, multiplier: schema.productUnits.multiplier })
          .from(schema.productUnits).where(and(eq(schema.productUnits.storeId, storeId), eq(schema.productUnits.sku, sku))).limit(1);
        const skuProducts = await tx.select({ id: schema.products.id }).from(schema.products)
          .where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, sku))).limit(1);
        if (skuProducts.length > 0) throw new Error(`Unit SKU ${sku} is already a product SKU`);
        const direct = await tx.select({ id: schema.products.id }).from(schema.products)
          .where(and(eq(schema.products.storeId, storeId), eq(schema.products.sku, baseSku)));
        const mapped = await tx.select({ id: schema.productSourceMappings.productId }).from(schema.productSourceMappings)
          .where(and(eq(schema.productSourceMappings.storeId, storeId), eq(schema.productSourceMappings.provider, "kiotviet"),
            eq(schema.productSourceMappings.externalId, baseSku), isNull(schema.productSourceMappings.deletedAt)));
        const baseIds = [...new Set([...direct, ...mapped].map((item) => item.id))];
        if (baseIds.length !== 1) throw new Error(`Base product ${baseSku} for unit ${sku} must resolve to exactly one POS product`);
        const productId = baseIds[0]!;
        if (existingUnit.length > 0) {
          const unit = existingUnit[0]!;
          if (unit.productId !== productId || unit.unitName !== unitName || Number(unit.multiplier) !== multiplier) {
            throw new Error(`Unit ${sku} already exists with different details`);
          }
          continue; // already linked
        }
        const [base] = await tx.select({ retailPrice: schema.products.retailPrice }).from(schema.products)
          .where(and(eq(schema.products.storeId, storeId), eq(schema.products.id, productId))).limit(1);
        const unitPrice = priceOf(row);
        const derived = Math.round(Number(base!.retailPrice) * multiplier * 100) / 100;
        changes.push({
          kind: "unit", productId, baseSku, sku, unitName, multiplier,
          priceOverride: unitPrice > 0 && unitPrice !== derived ? unitPrice : null,
          directSale: text(row["Được bán trực tiếp"]) !== "0",
          barcode: text(row["Mã vạch"]) || null,
        });
      }
    }

    if (args.apply) {
      for (const change of changes) {
        if (change.kind === "record") {
          const table = tables[change.entity];
          const updated = await tx.update(table).set({ code: change.to })
            .where(and(eq(table.storeId, storeId), eq(table.id, change.localId), eq(table.code, change.from)))
            .returning({ id: table.id });
          if (updated.length !== 1) throw new Error(`${change.entity} ${change.from} changed while recoding`);
          await tx.insert(schema.auditLogs).values({
            storeId, source: "system", action: "kiotviet.pos_code.assigned", entityType: change.entity,
            entityId: change.localId, status: "succeeded",
            before: { code: change.from }, after: { code: change.to, kiotvietCode: change.externalId },
          });
        } else if (change.kind === "product_link") {
          await tx.insert(schema.productSourceMappings).values({
            storeId, productId: change.productId, provider: "kiotviet", externalId: change.externalId, lastSeenAt: new Date(),
          });
          await tx.insert(schema.auditLogs).values({
            storeId, source: "system", action: "kiotviet.product.linked", entityType: "product",
            entityId: change.productId, status: "succeeded", after: { sku: change.posSku, kiotvietSku: change.externalId },
          });
        } else if (change.kind === "unit") {
          const [last] = await tx.select({ sortOrder: schema.productUnits.sortOrder }).from(schema.productUnits)
            .where(and(eq(schema.productUnits.storeId, storeId), eq(schema.productUnits.productId, change.productId)))
            .orderBy(desc(schema.productUnits.sortOrder)).limit(1);
          const [unit] = await tx.insert(schema.productUnits).values({
            storeId, productId: change.productId, sku: change.sku, unitName: change.unitName,
            multiplier: String(change.multiplier), barcode: change.barcode,
            priceOverride: change.priceOverride == null ? null : String(change.priceOverride),
            directSale: change.directSale, sortOrder: (last?.sortOrder ?? -1) + 1,
          }).returning({ id: schema.productUnits.id });
          await tx.insert(schema.auditLogs).values({
            storeId, source: "system", action: "kiotviet.unit.linked", entityType: "product",
            entityId: change.productId, status: "succeeded",
            after: { unitId: unit!.id, kiotvietSku: change.sku, unitName: change.unitName, multiplier: change.multiplier, priceOverride: change.priceOverride },
          });
        } else {
          const updated = await tx.update(schema.products).set({ sku: change.to, updatedAt: new Date() })
            .where(and(eq(schema.products.storeId, storeId), eq(schema.products.id, change.productId), eq(schema.products.sku, change.from)))
            .returning({ id: schema.products.id });
          if (updated.length !== 1) throw new Error(`Product ${change.from} changed while recoding`);
          await tx.insert(schema.productSourceMappings).values({
            storeId, productId: change.productId, provider: "kiotviet", externalId: change.from, lastSeenAt: new Date(),
          });
          await tx.insert(schema.auditLogs).values({
            storeId, source: "system", action: "kiotviet.pos_sku.assigned", entityType: "product",
            entityId: change.productId, status: "succeeded",
            before: { sku: change.from }, after: { sku: change.to, kiotvietSku: change.from },
          });
        }
      }
    }
    return { applied: args.apply, changes };
  });
}

async function main() {
  const result = await runKiotVietPosCodes(process.argv.slice(2));
  console.log(`${result.applied ? "APPLIED" : "DRY-RUN"} · ${result.changes.length} change(s)`);
  for (const change of result.changes) {
    if (change.kind === "record") console.log(`${change.entity.padEnd(15)} ${change.from} -> ${change.to}`);
    else if (change.kind === "product_link") console.log(`product link    ${change.externalId} -> ${change.posSku}`);
    else if (change.kind === "product") console.log(`product         ${change.from} -> ${change.to} (KiotViet SKU kept as mapping)`);
    else console.log(`unit            ${change.sku}: ${change.unitName} x${change.multiplier} of ${change.baseSku}${change.priceOverride == null ? "" : ` @${change.priceOverride}`}`);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

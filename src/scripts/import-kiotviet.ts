/**
 * Import master data từ export KiotViet (Phase 1).
 *
 * Usage:
 *   bun import:kiotviet [thư_mục] [--dry-run]
 *
 * - Thư mục mặc định: ./kiotviet_data (chứa các file DanhSachSanPham_*.xlsx,
 *   DanhSachKhachHang_*.xlsx, DanhSachNhaCungCap_*.xlsx)
 * - --dry-run: chỉ parse + in thống kê, KHÔNG ghi DB
 * - Idempotent: SP theo SKU, KH/NCC theo mã — chạy lại không nhân đôi
 *
 * Phạm vi Phase 1: nhóm hàng (có cha-con), thương hiệu, sản phẩm + đơn vị
 * quy đổi, tồn kho (kèm movement init, giữ tồn âm), khách hàng (kèm công nợ),
 * nhà cung cấp (kèm nợ phải trả).
 * Phase 2 (lịch sử hóa đơn/nhập/trả/sổ quỹ) chưa nằm trong script này.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { assertLegacyKiotVietDataImportReadOnly } from "../lib/kiotviet/data-sync-runner";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// cập nhật thuộc tính + tên cho SP đã import (data cũ thiếu Thuộc tính)
const updateAttrs = args.includes("--update-attrs");
const dir = args.find((a) => !a.startsWith("--")) ?? "kiotviet_data";

const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(4);

// ============ đọc file ============

function findFile(prefix: string): string | null {
  const files = readdirSync(dir).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".xlsx") && !f.includes("(1)")
  );
  return files.length > 0 ? join(dir, files.sort().reverse()[0]) : null; // file mới nhất
}

function readSheet(path: string): Record<string, unknown>[] {
  // XLSX.read(buffer) thay vì readFile — ESM build của sheetjs không gắn fs
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
/** Cắt theo độ dài cột varchar (vd phone 20, tax_code 30) — KiotViet hay nhét 2 SĐT. */
const clip = (v: string, max: number): string | null => (v ? v.slice(0, max) : null);

// ============ parse SanPham ============

interface ParsedUnit {
  baseSku: string;
  unitName: string;
  multiplier: number;
  barcode: string;
  priceOverride: number | null;
  stock: number; // theo đơn vị này — quy về base khi cộng tồn
}

interface ParsedProduct {
  sku: string;
  barcode: string;
  name: string;          // tên + hậu tố thuộc tính (để phân biệt SP cùng tên)
  categoryPath: string[]; // ["Kim Khí", "Bu lông"]
  brand: string;
  baseUnit: string;
  costPrice: number;
  retailPrice: number;
  stock: number;
  minLevel: number;
  location: string;
  description: string;
  weight: number | null;
  isActive: boolean;
  specs: Record<string, string[]> | null; // thuộc tính: {SIZE:["21"], "LOẠI ỐNG":["C2"]}
}

/**
 * Tách "SIZE:21|LOẠI ỐNG:C2" → { specs, suffix }.
 * suffix dùng ghép vào tên cho SP cùng tên khác thuộc tính (vd " - 21 - C2").
 */
function parseAttrs(raw: string): { specs: Record<string, string[]> | null; suffix: string } {
  if (!raw) return { specs: null, suffix: "" };
  const specs: Record<string, string[]> = {};
  const vals: string[] = [];
  for (const part of raw.split("|")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key || !val) continue;
    specs[key] = [val];
    vals.push(val);
  }
  if (vals.length === 0) return { specs: null, suffix: "" };
  return { specs, suffix: ` - ${vals.join(" - ")}` };
}

function parseProducts(rows: Record<string, unknown>[]) {
  const products: ParsedProduct[] = [];
  const units: ParsedUnit[] = [];

  for (const r of rows) {
    const sku = str(r["Mã hàng"]);
    if (!sku) continue;
    const baseSku = str(r["Mã ĐVT Cơ bản"]);

    if (baseSku) {
      // dòng đơn vị quy đổi của SP khác
      units.push({
        baseSku,
        unitName: str(r["ĐVT"]) || "đv",
        multiplier: num(r["Quy đổi"]) || 1,
        barcode: str(r["Mã vạch"]),
        priceOverride: r["Giá bán"] != null ? num(r["Giá bán"]) : null,
        stock: num(r["Tồn kho"]),
      });
    } else {
      const { specs, suffix } = parseAttrs(str(r["Thuộc tính"]));
      const baseName = str(r["Tên hàng"]) || sku;
      products.push({
        sku,
        barcode: str(r["Mã vạch"]),
        name: baseName + suffix, // ghép thuộc tính để phân biệt SP cùng tên
        categoryPath: str(r["Nhóm hàng(3 Cấp)"]).split(">>").map((s) => s.trim()).filter(Boolean),
        brand: str(r["Thương hiệu"]),
        baseUnit: str(r["ĐVT"]) || "cái",
        costPrice: num(r["Giá vốn"]),
        retailPrice: num(r["Giá bán"]),
        stock: num(r["Tồn kho"]),
        minLevel: num(r["Tồn nhỏ nhất"]),
        location: str(r["Vị trí"]),
        description: str(r["Mô tả"]),
        weight: r["Trọng lượng"] != null && num(r["Trọng lượng"]) > 0 ? num(r["Trọng lượng"]) : null,
        isActive: str(r["Đang kinh doanh"]) !== "0",
        specs,
      });
    }
  }
  return { products, units };
}

// ============ parse KhachHang / NhaCungCap ============

interface ParsedCustomer {
  code: string; name: string; phone: string; address: string; email: string;
  taxCode: string; note: string; debt: number; totalSpent: number;
  isCompany: boolean; isActive: boolean;
}

function parseCustomers(rows: Record<string, unknown>[]): ParsedCustomer[] {
  return rows
    .filter((r) => str(r["Mã khách hàng"]))
    .map((r) => ({
      code: str(r["Mã khách hàng"]),
      name: str(r["Tên khách hàng"]) || str(r["Mã khách hàng"]),
      phone: str(r["Điện thoại"]),
      address: [str(r["Địa chỉ"]), str(r["Phường/Xã"]), str(r["Khu vực giao hàng"])].filter(Boolean).join(", "),
      email: str(r["Email"]),
      taxCode: str(r["Mã số thuế"]),
      note: [str(r["Công ty"]), str(r["Nhóm khách hàng"]), str(r["Ghi chú"])].filter(Boolean).join(" · "),
      debt: num(r["Nợ cần thu hiện tại"]),
      totalSpent: num(r["Tổng bán trừ trả hàng"]),
      isCompany: str(r["Loại khách"]) === "Công ty",
      isActive: str(r["Trạng thái"]) !== "0",
    }));
}

interface ParsedSupplier {
  code: string; name: string; phone: string; address: string; email: string;
  taxCode: string; note: string; debt: number;
}

function parseSuppliers(rows: Record<string, unknown>[]): ParsedSupplier[] {
  return rows
    .filter((r) => str(r["Mã nhà cung cấp"]))
    .map((r) => ({
      code: str(r["Mã nhà cung cấp"]),
      name: str(r["Tên nhà cung cấp"]) || str(r["Mã nhà cung cấp"]),
      phone: str(r["Điện thoại"]),
      address: [str(r["Địa chỉ"]), str(r["Phường/Xã"]), str(r["Khu vực"])].filter(Boolean).join(", "),
      email: str(r["Email"]),
      taxCode: str(r["Mã số thuế"]),
      note: [str(r["Công ty"]), str(r["Nhóm nhà cung cấp"]), str(r["Ghi chú"])].filter(Boolean).join(" · "),
      debt: num(r["Nợ cần trả hiện tại"]),
    }));
}

// ============ main ============

async function main() {
  assertLegacyKiotVietDataImportReadOnly(dryRun);
  console.log(`📂 Đọc thư mục: ${dir}${dryRun ? "  (DRY RUN — không ghi DB)" : ""}\n`);

  const fSP = findFile("DanhSachSanPham");
  const fKH = findFile("DanhSachKhachHang");
  const fNCC = findFile("DanhSachNhaCungCap");
  if (!fSP) throw new Error("Không tìm thấy file DanhSachSanPham_*.xlsx");

  const { products: parsedProducts, units: parsedUnits } = parseProducts(readSheet(fSP));
  const parsedCustomers = fKH ? parseCustomers(readSheet(fKH)) : [];
  const parsedSuppliers = fNCC ? parseSuppliers(readSheet(fNCC)) : [];

  // gom đơn vị theo SP gốc + cộng tồn quy đổi
  const unitsByBase = new Map<string, ParsedUnit[]>();
  let orphanUnits = 0;
  const productSkus = new Set(parsedProducts.map((p) => p.sku));
  for (const u of parsedUnits) {
    if (!productSkus.has(u.baseSku)) { orphanUnits++; continue; }
    const list = unitsByBase.get(u.baseSku) ?? [];
    list.push(u);
    unitsByBase.set(u.baseSku, list);
  }

  const cats = new Set(parsedProducts.map((p) => p.categoryPath.join(">>")).filter(Boolean));
  const brands = new Set(parsedProducts.map((p) => p.brand).filter(Boolean));
  const negStock = parsedProducts.filter((p) => p.stock < 0).length;
  const totalDebt = parsedCustomers.reduce((s, c) => s + c.debt, 0);
  const totalPayable = parsedSuppliers.reduce((s, c) => s + c.debt, 0);
  const stockValue = parsedProducts.reduce((s, p) => s + p.stock * p.costPrice, 0);

  console.log(`SP gốc: ${parsedProducts.length} · đơn vị quy đổi: ${parsedUnits.length} (orphan: ${orphanUnits})`);
  console.log(`Nhóm hàng: ${cats.size} · thương hiệu: ${brands.size} · SP tồn âm: ${negStock}`);
  console.log(`Giá trị tồn (theo giá vốn): ${(stockValue / 1e6).toFixed(1)}tr`);
  console.log(`Khách hàng: ${parsedCustomers.length} (tổng nợ thu ${(totalDebt / 1e6).toFixed(1)}tr)`);
  console.log(`NCC: ${parsedSuppliers.length} (tổng nợ trả ${(totalPayable / 1e6).toFixed(1)}tr)\n`);

  if (dryRun) {
    console.log("✅ Dry-run xong — dùng sync:kiotviet-products để đồng bộ sản phẩm an toàn.");
    process.exit(0);
  }

  // ---- ghi DB (lazy import để dry-run không cần DATABASE_URL) ----
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { eq, and, isNull, desc, sql } = await import("drizzle-orm");

  // ===== chế độ cập nhật thuộc tính cho SP đã import (không tạo mới) =====
  if (updateAttrs) {
    const existing = await db.select({
      id: schema.products.id, sku: schema.products.sku,
      name: schema.products.name, specs: schema.products.specs,
    }).from(schema.products);
    const bySku = new Map(existing.map((p) => [p.sku, p]));
    let updated = 0, addedName = 0;
    for (const p of parsedProducts) {
      if (!p.specs) continue;
      const cur = bySku.get(p.sku);
      if (!cur) continue;
      const hasSpecs = cur.specs && Object.keys(cur.specs).length > 0;
      // tên đã ghép hậu tố chưa? (p.name = baseName + suffix)
      const nameHasSuffix = cur.name === p.name;
      if (hasSpecs && nameHasSuffix) continue;
      await db.update(schema.products).set({
        specs: p.specs,
        ...(nameHasSuffix ? {} : { name: p.name }),
        updatedAt: sql`now()`,
      }).where(eq(schema.products.id, cur.id));
      updated++;
      if (!nameHasSuffix) addedName++;
    }
    console.log(`✓ Cập nhật thuộc tính: ${updated} SP (ghép tên: ${addedName})`);
    console.log("✅ Xong chế độ --update-attrs (không tạo SP/KH/NCC mới).");
    process.exit(0);
  }

  // kho mặc định
  const [wh] = await db.select().from(schema.warehouses).orderBy(desc(schema.warehouses.isDefault)).limit(1);
  const warehouse = wh ?? (await db.insert(schema.warehouses).values({ name: "Kho chính", isDefault: true }).returning())[0];

  // ---- categories (cha-con) ----
  const catIdByPath = new Map<string, string>();
  async function ensureCategory(path: string[]): Promise<string | null> {
    if (path.length === 0) return null;
    const key = path.join(">>");
    if (catIdByPath.has(key)) return catIdByPath.get(key)!;
    const parentId = await ensureCategory(path.slice(0, -1));
    const name = path[path.length - 1];
    const where = parentId
      ? and(eq(schema.categories.name, name), eq(schema.categories.parentId, parentId))
      : and(eq(schema.categories.name, name), isNull(schema.categories.parentId));
    let [found] = await db.select().from(schema.categories).where(where).limit(1);
    if (!found) {
      [found] = await db.insert(schema.categories).values({ name, parentId }).returning();
    }
    catIdByPath.set(key, found.id);
    return found.id;
  }

  // ---- brands ----
  const brandIdByName = new Map<string, string>();
  for (const b of await db.select().from(schema.brands)) brandIdByName.set(b.name, b.id);
  async function ensureBrand(name: string): Promise<string | null> {
    if (!name) return null;
    if (brandIdByName.has(name)) return brandIdByName.get(name)!;
    const [row] = await db.insert(schema.brands).values({ name }).onConflictDoNothing().returning();
    const id = row?.id
      ?? (await db.select().from(schema.brands).where(eq(schema.brands.name, name)).limit(1))[0].id;
    brandIdByName.set(name, id);
    return id;
  }

  // ---- products ----
  const existingSkus = new Set(
    (await db.select({ sku: schema.products.sku }).from(schema.products)).map((r) => r.sku)
  );
  let created = 0, skipped = 0, unitCount = 0;

  for (const p of parsedProducts) {
    if (existingSkus.has(p.sku)) { skipped++; continue; }
    const categoryId = await ensureCategory(p.categoryPath);
    const brandId = await ensureBrand(p.brand);
    const units = unitsByBase.get(p.sku) ?? [];
    // tồn tổng theo đơn vị gốc = tồn base + Σ(tồn đơn vị × quy đổi)
    const totalStockBase = p.stock + units.reduce((s, u) => s + u.stock * u.multiplier, 0);

    await db.transaction(async (tx) => {
      const [prod] = await tx.insert(schema.products).values({
        sku: p.sku.slice(0, 50),
        barcode: clip(p.barcode, 50),
        name: p.name,
        categoryId,
        brandId,
        baseUnit: p.baseUnit.slice(0, 20),
        costPrice: money(p.costPrice),
        retailPrice: money(p.retailPrice),
        location: p.location || null,
        description: p.description || null,
        weight: p.weight != null ? String(p.weight) : null,
        specs: p.specs,
        isActive: p.isActive,
      }).returning({ id: schema.products.id });

      if (units.length > 0) {
        await tx.insert(schema.productUnits).values(units.map((u, i) => ({
          productId: prod.id,
          unitName: u.unitName.slice(0, 30),
          multiplier: qty(u.multiplier),
          barcode: clip(u.barcode, 50),
          priceOverride: u.priceOverride != null ? money(u.priceOverride) : null,
          sortOrder: i,
        })));
        unitCount += units.length;
      }

      await tx.insert(schema.stockLevels).values({
        productId: prod.id,
        warehouseId: warehouse.id,
        quantity: qty(totalStockBase),
        minLevel: qty(p.minLevel),
      }).onConflictDoNothing();

      if (Math.abs(totalStockBase) > 1e-9) {
        await tx.insert(schema.stockMovements).values({
          productId: prod.id,
          warehouseId: warehouse.id,
          type: "init",
          quantity: qty(totalStockBase),
          unitCost: money(p.costPrice),
          refType: "kiotviet_import",
          note: "Tồn đầu import từ KiotViet",
        });
      }
    });
    created++;
    if (created % 250 === 0) console.log(`  … ${created} SP`);
  }
  console.log(`✓ Sản phẩm: +${created} (bỏ qua ${skipped} đã có) · đơn vị quy đổi: +${unitCount}`);

  // ---- customers ----
  const existingKH = new Set(
    (await db.select({ code: schema.customers.code }).from(schema.customers)).map((r) => r.code)
  );
  let khNew = 0;
  for (const c of parsedCustomers) {
    if (existingKH.has(c.code)) continue;
    await db.insert(schema.customers).values({
      code: clip(c.code, 30),
      name: c.name,
      phone: clip(c.phone, 20),
      email: c.email || null,
      address: c.address || null,
      type: c.isCompany ? "wholesale" : "retail",
      taxCode: clip(c.taxCode, 30),
      note: c.note || null,
      currentDebt: money(c.debt),
      totalSpent: money(c.totalSpent),
      isActive: c.isActive,
    });
    khNew++;
  }
  console.log(`✓ Khách hàng: +${khNew} (bỏ qua ${parsedCustomers.length - khNew})`);

  // ---- suppliers ----
  const existingNCC = new Set(
    (await db.select({ code: schema.suppliers.code }).from(schema.suppliers)).map((r) => r.code)
  );
  let nccNew = 0;
  for (const s of parsedSuppliers) {
    if (existingNCC.has(s.code)) continue;
    await db.insert(schema.suppliers).values({
      code: clip(s.code, 30),
      name: s.name,
      phone: clip(s.phone, 20),
      email: s.email || null,
      address: s.address || null,
      taxCode: clip(s.taxCode, 30),
      note: s.note || null,
      currentDebt: money(s.debt),
    });
    nccNew++;
  }
  console.log(`✓ Nhà cung cấp: +${nccNew} (bỏ qua ${parsedSuppliers.length - nccNew})`);

  console.log("\n✅ Import Phase 1 hoàn tất. Lịch sử hóa đơn/nhập/trả (Phase 2) chưa import.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Import lỗi:", e);
  process.exit(1);
});

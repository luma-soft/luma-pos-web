/**
 * Import LỊCH SỬ chứng từ từ export KiotViet (Phase 2) — ledger-only.
 *
 * Usage:
 *   bun import:kiotviet-history [thư_mục] [--dry-run]
 *
 * Import: hóa đơn bán (DanhSachChiTietHoaDon), phiếu nhập (DanhSachChiTietNhapHang),
 * trả hàng (DanhSachChiTietTraHang), trả hàng nhập (DanhSachChiTietTraHangNhap),
 * sổ quỹ (SoQuy). KHÔNG import: DatHang, KiemKho, BangGia.
 *
 * QUAN TRỌNG — ledger-only:
 * - KHÔNG tạo stock movement, KHÔNG cộng/trừ tồn kho
 * - KHÔNG đụng công nợ KH/NCC (snapshot Phase 1 là chuẩn)
 * - Chỉ insert bản ghi chứng từ để xem lịch sử + báo cáo
 *
 * Idempotent theo mã chứng từ (HD/PN/TH/THN/mã phiếu quỹ): chạy lại hoặc
 * import file export mới hơn → chỉ thêm chứng từ chưa có, không nhân đôi.
 * Chạy SAU khi Phase 1 (import:kiotviet) đã xong để có SP/KH/NCC.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dir = args.find((a) => !a.startsWith("--")) ?? "kiotviet_data";

const money = (n: number) => n.toFixed(2);
const qtyS = (n: number) => n.toFixed(4);
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
/** Cắt theo độ dài cột varchar (vd phone 20). */
const clip = (v: string, max: number): string | null => (v ? v.slice(0, max) : null);

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    // KiotViet "dd/mm/yyyy hh:mm" nếu cell là text
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  }
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function findFile(prefix: string, exclude?: string): string | null {
  const files = readdirSync(dir).filter(
    (f) =>
      f.startsWith(prefix) && f.endsWith(".xlsx") && !f.includes("(1)") &&
      (!exclude || !f.startsWith(exclude))
  );
  return files.length > 0 ? join(dir, files.sort().reverse()[0]) : null;
}

function readSheet(path: string): Record<string, unknown>[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

/** Gom các dòng chi tiết theo mã chứng từ (giữ thứ tự xuất hiện). */
function groupBy(rows: Record<string, unknown>[], codeCol: string) {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const code = str(r[codeCol]);
    if (!code) continue;
    const list = map.get(code) ?? [];
    list.push(r);
    map.set(code, list);
  }
  return map;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Phương thức thanh toán nhiều tiền nhất trên chứng từ. */
function pickMethod(r: Record<string, unknown>): "cash" | "card" | "bank_transfer" | "momo" {
  const opts = [
    ["cash", num(r["Tiền mặt"])],
    ["card", num(r["Thẻ"])],
    ["bank_transfer", num(r["Chuyển khoản"])],
    ["momo", num(r["Ví"])],
  ] as const;
  return opts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))[0];
}

/** Map "Loại thu chi" KiotViet → category sổ quỹ của app. */
function cashCategory(loai: string, type: "in" | "out"): string {
  if (loai.includes("khách trả") && type === "in") return "sale";
  if (loai.includes("trả NCC")) return "supplier_payment";
  if (loai.includes("trả khách")) return "refund";
  if (loai.includes("hoàn trả")) return "other";
  if (loai.includes("Chi phí") || loai.includes("Vận Chuyển")) return "expense";
  return type === "in" ? "other" : "expense";
}

async function main() {
  console.log(`📂 Đọc thư mục: ${dir}${dryRun ? "  (DRY RUN — không ghi DB)" : ""}\n`);

  const fHD = findFile("DanhSachChiTietHoaDon");
  const fPN = findFile("DanhSachChiTietNhapHang");
  const fTH = findFile("DanhSachChiTietTraHang", "DanhSachChiTietTraHangNhap");
  const fTHN = findFile("DanhSachChiTietTraHangNhap");
  const fSQ = findFile("SoQuy");

  const hdGroups = fHD ? groupBy(readSheet(fHD), "Mã hóa đơn") : new Map();
  const pnGroups = fPN ? groupBy(readSheet(fPN), "Mã nhập hàng") : new Map();
  const thGroups = fTH ? groupBy(readSheet(fTH), "Mã trả hàng") : new Map();
  const thnGroups = fTHN ? groupBy(readSheet(fTHN), "Mã trả hàng nhập") : new Map();
  const sqRows = fSQ ? readSheet(fSQ) : [];

  console.log(`Hóa đơn: ${hdGroups.size} · Phiếu nhập: ${pnGroups.size} · Trả hàng: ${thGroups.size} · Trả hàng nhập: ${thnGroups.size} · Sổ quỹ: ${sqRows.length} dòng`);

  // SKU xuất hiện trong lịch sử
  const allSkus = new Set<string>();
  for (const rows of [...hdGroups.values(), ...thGroups.values()])
    for (const r of rows) { const s = str(r["Mã hàng"]); if (s) allSkus.add(s); }
  for (const rows of [...pnGroups.values(), ...thnGroups.values()])
    for (const r of rows) { const s = str(r["Mã hàng"]); if (s) allSkus.add(s); }
  console.log(`SKU tham chiếu trong lịch sử: ${allSkus.size}\n`);

  if (dryRun) {
    console.log("✅ Dry-run xong — chạy lại không có --dry-run để ghi vào DB.");
    process.exit(0);
  }

  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { desc, inArray: inArr } = await import("drizzle-orm");

  const [wh] = await db.select().from(schema.warehouses).orderBy(desc(schema.warehouses.isDefault)).limit(1);
  if (!wh) throw new Error("Chưa có kho — chạy Phase 1 (bun import:kiotviet) trước.");

  // ---- map SP / KH / NCC / đơn vị ----
  const prodRows = await db.select({
    id: schema.products.id, sku: schema.products.sku,
    baseUnit: schema.products.baseUnit, cost: schema.products.costPrice,
  }).from(schema.products);
  const prodBySku = new Map(prodRows.map((p) => [p.sku, p]));

  const unitRows = await db.select({
    productId: schema.productUnits.productId,
    unitName: schema.productUnits.unitName,
    multiplier: schema.productUnits.multiplier,
  }).from(schema.productUnits);
  const unitKey = (pid: string, name: string) => `${pid}|${name.toLowerCase()}`;
  const unitMap = new Map(unitRows.map((u) => [unitKey(u.productId, u.unitName), Number(u.multiplier)]));

  const custRows = await db.select({ id: schema.customers.id, code: schema.customers.code }).from(schema.customers);
  const custByCode = new Map(custRows.filter((c) => c.code).map((c) => [c.code!, c.id]));
  const suppRows = await db.select({ id: schema.suppliers.id, code: schema.suppliers.code }).from(schema.suppliers);
  const suppByCode = new Map(suppRows.filter((s) => s.code).map((s) => [s.code!, s.id]));

  // SP đã xóa bên KiotViet nhưng còn trong lịch sử → tạo placeholder (ẩn)
  const missingSkus = [...allSkus].filter((s) => !prodBySku.has(s));
  if (missingSkus.length > 0) {
    const nameBySku = new Map<string, string>();
    for (const rows of [...hdGroups.values(), ...pnGroups.values(), ...thGroups.values(), ...thnGroups.values()])
      for (const r of rows) {
        const s = str(r["Mã hàng"]);
        if (s && !nameBySku.has(s)) nameBySku.set(s, str(r["Tên hàng"]) || s);
      }
    for (const batch of chunk(missingSkus, 200)) {
      const inserted = await db.insert(schema.products).values(batch.map((sku) => ({
        sku: sku.slice(0, 50),
        name: nameBySku.get(sku) ?? sku,
        baseUnit: "cái",
        costPrice: "0",
        retailPrice: "0",
        isActive: false,
        description: "SP tạo tự động từ import lịch sử KiotViet (đã ngừng kinh doanh)",
      }))).onConflictDoNothing().returning({ id: schema.products.id, sku: schema.products.sku });
      for (const p of inserted) prodBySku.set(p.sku, { id: p.id, sku: p.sku, baseUnit: "cái", cost: "0" });
    }
    console.log(`✓ Tạo ${missingSkus.length} SP placeholder (đã ngừng kinh doanh, ẩn)`);
  }

  const resolveUnit = (productId: string, dvt: string, baseUnit: string) => {
    const name = dvt || baseUnit;
    const mult = dvt ? (unitMap.get(unitKey(productId, dvt)) ?? 1) : 1;
    return { name, mult };
  };

  // ---- chứng từ đã có (idempotent) ----
  const existOrder = new Set((await db.select({ c: schema.orders.code }).from(schema.orders)).map((r) => r.c));
  const existPO = new Set((await db.select({ c: schema.purchaseOrders.code }).from(schema.purchaseOrders)).map((r) => r.c));
  const existPurchaseReturn = new Set((await db.select({ c: schema.purchaseReturns.code }).from(schema.purchaseReturns)).map((r) => r.c));
  const existRet = new Set((await db.select({ c: schema.returns.code }).from(schema.returns)).map((r) => r.c));
  const existCash = new Set((await db.select({ c: schema.cashTransactions.code }).from(schema.cashTransactions)).map((r) => r.c));

  // ============ 1. Hóa đơn → orders ============
  type OrderIns = typeof schema.orders.$inferInsert;
  type ItemIns = typeof schema.orderItems.$inferInsert;
  type PayIns = typeof schema.payments.$inferInsert;
  const ordIns: OrderIns[] = [];
  const itemIns: ItemIns[] = [];
  const payIns: PayIns[] = [];
  const orderIdByCode = new Map<string, string>();
  const orderItemsByOrder = new Map<string, { id: string; productId: string }[]>();
  let hdSkip = 0;

  for (const [code, rows] of hdGroups) {
    if (existOrder.has(code)) { hdSkip++; continue; }
    const h = rows[0];
    const id = randomUUID();
    const status = str(h["Trạng thái"]) === "Đã hủy" ? "cancelled" : "completed";
    const total = num(h["Khách cần trả"]);
    const paid = num(h["Khách đã trả"]);
    const ts = toDate(h["Thời gian"]);

    ordIns.push({
      id, code, status,
      paymentStatus: paid >= total && total > 0 ? "paid" : paid > 0 ? "partial" : total === 0 ? "paid" : "unpaid",
      customerId: custByCode.get(str(h["Mã khách hàng"])) ?? null,
      warehouseId: wh.id,
      subtotal: money(num(h["Tổng tiền hàng"])),
      discount: money(num(h["Giảm giá hóa đơn"])),
      tax: money(num(h["VAT"])),
      total: money(total),
      amountPaid: money(Math.min(paid, total)),
      note: str(h["Ghi chú"]) || null,
      createdAt: ts, updatedAt: ts,
    });
    orderIdByCode.set(code, id);

    const oi: { id: string; productId: string }[] = [];
    for (const r of rows) {
      const p = prodBySku.get(str(r["Mã hàng"]));
      if (!p) continue;
      const u = resolveUnit(p.id, str(r["ĐVT"]), p.baseUnit);
      const iid = randomUUID();
      itemIns.push({
        id: iid, orderId: id, productId: p.id,
        productName: str(r["Tên hàng"]) || p.sku,
        unitName: u.name.slice(0, 30), unitMultiplier: qtyS(u.mult),
        quantity: qtyS(num(r["Số lượng"])),
        unitPrice: money(num(r["Đơn giá"])),
        discount: money(num(r["Giảm giá"])),
        total: money(num(r["Thành tiền"])),
        note: str(r["Ghi chú hàng hóa"]) || null,
      });
      oi.push({ id: iid, productId: p.id });
    }
    orderItemsByOrder.set(code, oi);

    if (paid > 0 && status !== "cancelled") {
      payIns.push({
        orderId: id, amount: money(Math.min(paid, total)),
        method: pickMethod(h), note: "Import lịch sử KiotViet", createdAt: ts,
      });
    }
  }

  for (const b of chunk(ordIns, 200)) await db.insert(schema.orders).values(b);
  for (const b of chunk(itemIns, 500)) await db.insert(schema.orderItems).values(b);
  for (const b of chunk(payIns, 500)) await db.insert(schema.payments).values(b);
  console.log(`✓ Hóa đơn: +${ordIns.length} (bỏ qua ${hdSkip} đã có) · ${itemIns.length} dòng hàng · ${payIns.length} thanh toán`);

  // ============ 2. Phiếu nhập → purchase_orders ============
  type POIns = typeof schema.purchaseOrders.$inferInsert;
  type POItemIns = typeof schema.purchaseOrderItems.$inferInsert;
  const poIns: POIns[] = [];
  const poItemIns: POItemIns[] = [];
  let pnSkip = 0;

  const ensureSupplier = async (code: string, name: string, phone: string) => {
    if (suppByCode.has(code)) return suppByCode.get(code)!;
    const [s] = await db.insert(schema.suppliers).values({
      code: clip(code, 30), name: name || code || "NCC không rõ", phone: clip(phone, 20),
      note: "Tạo từ import lịch sử KiotViet",
    }).returning({ id: schema.suppliers.id });
    if (code) suppByCode.set(code, s.id);
    return s.id;
  };

  for (const [code, rows] of pnGroups) {
    if (existPO.has(code)) { pnSkip++; continue; }
    const h = rows[0];
    const supplierId = await ensureSupplier(str(h["Mã nhà cung cấp"]), str(h["Tên nhà cung cấp"]), str(h["Điện thoại"]));
    const id = randomUUID();
    poIns.push({
      id, code, supplierId, warehouseId: wh.id,
      status: str(h["Trạng thái"]) === "Đã hủy" ? "cancelled" : "received",
      total: money(num(h["Cần trả NCC"])),
      amountPaid: money(num(h["Tiền đã trả NCC"])),
      note: str(h["Ghi chú"]) || null,
      createdAt: toDate(h["Thời gian"]),
    });
    for (const r of rows) {
      const p = prodBySku.get(str(r["Mã hàng"]));
      if (!p) continue;
      poItemIns.push({
        purchaseOrderId: id, productId: p.id,
        quantity: qtyS(num(r["Số lượng"])),
        unitCost: money(num(r["Giá nhập"])),
        total: money(num(r["Thành tiền"])),
      });
    }
  }
  for (const b of chunk(poIns, 200)) await db.insert(schema.purchaseOrders).values(b);
  for (const b of chunk(poItemIns, 500)) await db.insert(schema.purchaseOrderItems).values(b);
  console.log(`✓ Phiếu nhập: +${poIns.length} (bỏ qua ${pnSkip} đã có) · ${poItemIns.length} dòng hàng`);

  // ============ 3. Trả hàng nhập → purchase_returns ============
  type PurchaseReturnIns = typeof schema.purchaseReturns.$inferInsert;
  type PurchaseReturnItemIns = typeof schema.purchaseReturnItems.$inferInsert;
  const thnIns: PurchaseReturnIns[] = [];
  const thnItemIns: PurchaseReturnItemIns[] = [];
  let thnSkip = 0;
  for (const [code, rows] of thnGroups) {
    if (existPurchaseReturn.has(code)) { thnSkip++; continue; }
    const h = rows[0];
    const supplierId = await ensureSupplier(str(h["Mã nhà cung cấp"]), str(h["Tên nhà cung cấp"]), str(h["Điện thoại"]));
    const id = randomUUID();
    const subtotal = num(h["Tổng tiền hàng trả"]);
    const discount = num(h["Giảm giá"]);
    const tax = num(h["VAT trả hàng nhập"]);
    const total = num(h["NCC cần trả"]);
    const paid = Math.min(num(h["Tiền NCC trả"]), total);
    const debt = Math.max(0, total - paid);
    const settlementStatus = paid <= 0 && debt <= 0 ? "unsettled" : paid + debt >= total ? "settled" : "partial";
    thnIns.push({
      id, code,
      purchaseOrderId: null,
      supplierId,
      warehouseId: wh.id,
      status: str(h["Trạng thái"]) === "Đã hủy" ? "draft" : "completed",
      settlementStatus,
      subtotal: money(subtotal),
      discount: money(discount),
      vatRate: "0",
      tax: money(tax),
      totalRefund: money(total),
      refundAmount: money(paid),
      refundMethod: paid > 0 ? "cash" : null,
      debtAmount: money(debt),
      note: str(h["Ghi chú"]) || "Import trả hàng nhập KiotViet",
      createdAt: toDate(h["Thời gian"]),
    });
    for (const r of rows) {
      const p = prodBySku.get(str(r["Mã hàng"]));
      if (!p) continue;
      const unitName = str(r["ĐVT"]) || p.baseUnit;
      const returnUnitCost = num(r["Giá trả lại"]);
      thnItemIns.push({
        purchaseReturnId: id,
        purchaseOrderItemId: null,
        productId: p.id,
        productName: str(r["Tên hàng"]) || p.sku,
        sku: p.sku.slice(0, 50),
        unitName: unitName.slice(0, 30),
        quantity: qtyS(num(r["Số lượng"])),
        unitCost: money(returnUnitCost),
        returnUnitCost: money(returnUnitCost),
        total: money(num(r["Thành tiền"])),
      });
    }
  }
  for (const b of chunk(thnIns, 200)) await db.insert(schema.purchaseReturns).values(b);
  for (const b of chunk(thnItemIns, 500)) await db.insert(schema.purchaseReturnItems).values(b);
  console.log(`✓ Trả hàng nhập: +${thnIns.length} (bỏ qua ${thnSkip} đã có)`);

  // ============ 4. Trả hàng → returns ============
  // cần map mã HĐ → order id (kể cả HĐ đã import từ trước)
  const refHd = new Set<string>();
  for (const rows of thGroups.values()) {
    const c = str(rows[0]["Mã hóa đơn"]);
    if (c && !orderIdByCode.has(c)) refHd.add(c);
  }
  if (refHd.size > 0) {
    const found = await db.select({ id: schema.orders.id, code: schema.orders.code })
      .from(schema.orders).where(inArr(schema.orders.code, [...refHd]));
    for (const o of found) orderIdByCode.set(o.code, o.id);
  }

  type RetIns = typeof schema.returns.$inferInsert;
  type RetItemIns = typeof schema.returnItems.$inferInsert;
  const retIns: RetIns[] = [];
  const retItemIns: RetItemIns[] = [];
  const returnedOrderIds: string[] = [];
  let thSkip = 0;

  for (const [code, rows] of thGroups) {
    if (existRet.has(code)) { thSkip++; continue; }
    const h = rows[0];
    const hdCode = str(h["Mã hóa đơn"]);
    const orderId = hdCode ? orderIdByCode.get(hdCode) ?? null : null;
    const orderItems = orderId && hdCode ? orderItemsByOrder.get(hdCode) ?? [] : [];
    const id = randomUUID();
    const refund = num(h["Cần trả khách"]);

    retIns.push({
      id, code, orderId,
      customerId: custByCode.get(str(h["Mã khách hàng"])) ?? null,
      warehouseId: wh.id,
      refundMethod: num(h["Chuyển khoản"]) !== 0 ? "bank_transfer" : num(h["Tiền mặt"]) !== 0 ? "cash" : "debt_deduct",
      totalRefund: money(refund),
      note: str(h["Ghi chú"]) || null,
      createdAt: toDate(h["Thời gian"]),
    });
    if (orderId) returnedOrderIds.push(orderId);

    for (const r of rows) {
      const p = prodBySku.get(str(r["Mã hàng"]));
      if (!p) continue;
      const u = resolveUnit(p.id, str(r["ĐVT"]), p.baseUnit);
      const q = num(r["Số lượng"]);
      const price = num(r["Giá bán"]);
      retItemIns.push({
        returnId: id,
        orderItemId: orderItems.find((i) => i.productId === p.id)?.id ?? null,
        productId: p.id,
        productName: str(r["Tên hàng"]) || p.sku,
        unitName: u.name.slice(0, 30), unitMultiplier: qtyS(u.mult),
        quantity: qtyS(q),
        unitPrice: money(price),
        total: money(q * price - num(r["Giảm giá"])),
        restock: true,
      });
    }
  }
  for (const b of chunk(retIns, 200)) await db.insert(schema.returns).values(b);
  for (const b of chunk(retItemIns, 500)) await db.insert(schema.returnItems).values(b);
  if (returnedOrderIds.length > 0) {
    await db.update(schema.orders).set({ status: "returned" })
      .where(inArr(schema.orders.id, returnedOrderIds));
  }
  console.log(`✓ Trả hàng: +${retIns.length} (bỏ qua ${thSkip} đã có) · ${returnedOrderIds.length} HĐ chuyển trạng thái "đã trả"`);

  // ============ 5. Sổ quỹ → cash_transactions ============
  type CashIns = typeof schema.cashTransactions.$inferInsert;
  const cashIns: CashIns[] = [];
  const seenCash = new Set<string>();
  let sqSkip = 0;
  for (const r of sqRows) {
    const code = str(r["Mã phiếu"]);
    if (!code) continue;
    if (existCash.has(code) || seenCash.has(code)) { sqSkip++; continue; }
    seenCash.add(code);
    const loai = str(r["Loại thu chi"]);
    const val = num(r["Giá trị"]);
    const type: "in" | "out" = loai.startsWith("Phiếu thu") ? "in" : loai.startsWith("Phiếu chi") ? "out" : val < 0 ? "out" : "in";
    cashIns.push({
      code, type, fund: "cash",
      amount: money(Math.abs(val)),
      category: cashCategory(loai, type),
      refType: "kiotviet_import",
      note: [loai, str(r["Người nộp/nhận"])].filter(Boolean).join(" — ") || null,
      createdAt: toDate(r["Thời gian"]),
    });
  }
  for (const b of chunk(cashIns, 500)) await db.insert(schema.cashTransactions).values(b);
  console.log(`✓ Sổ quỹ: +${cashIns.length} phiếu (bỏ qua ${sqSkip} đã có/trùng)`);

  console.log("\n✅ Import lịch sử hoàn tất (ledger-only — tồn kho & công nợ không đổi).");
  console.log("ℹ️  Không import: Đặt hàng (DH), Kiểm kho (KK), Bảng giá — snapshot Phase 1 là chuẩn.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Import lỗi:", e);
  process.exit(1);
});

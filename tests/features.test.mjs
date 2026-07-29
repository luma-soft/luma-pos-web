/* Feature smoke tests: quote→convert, edit order, merge, cashbook, promo lib, portal pricing.
   Mirrors action logic on PGlite. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const promo = await import(`${PROJ}/src/lib/promo.ts`);
const {
  products, stockLevels, warehouses, customers, orders, orderItems, payments,
  cashTransactions, stockMovements,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const money = (n) => n.toFixed(2);
const qty = (n) => n.toFixed(4);

console.log("0) Apply all migrations");
const migDir = `${PROJ}/drizzle`;
const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  for (const stmt of readFileSync(`${migDir}/${f}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s && !/create extension/i.test(s)) await client.exec(s); // PGlite khong co unaccent
  }
}
ok(`migrations: ${files.length} files (0000→000${files.length - 1})`, files.length >= 4);

// seed
const [wh] = await db.insert(warehouses).values({ name: "Kho", isDefault: true }).returning();
const [p] = await db.insert(products).values({
  sku: "XM1", name: "Xi măng", baseUnit: "bao",
  costPrice: money(84500), retailPrice: money(92000), contractorPrice: money(87000),
}).returning();
await db.insert(stockLevels).values({ productId: p.id, warehouseId: wh.id, quantity: qty(1000) });
const [cust] = await db.insert(customers).values({
  code: "KH1", name: "Anh Tuấn", type: "contractor", debtLimit: money(100_000_000),
  portalToken: "tok_0123456789abcdef0123",
}).returning();

// ===== 1. Promo lib =====
console.log("1) Khuyến mãi bậc thang (lib thuần)");
const tiers = [{ minQty: 50, discountPct: 3 }, { minQty: 200, discountPct: 5 }];
ok("dưới bậc: 0%", promo.bestTierPct(tiers, 10) === 0);
ok("bậc 1: 3%", promo.bestTierPct(tiers, 50) === 3);
ok("bậc 2: 5%", promo.bestTierPct(tiers, 250) === 5);
ok("applyPromo 92.000 −3% = 89.240", promo.applyPromo(92000, tiers, 100).price === 89240);
ok("promo hết hạn → inactive", promo.isPromoActive({ isActive: true, startsAt: null, endsAt: new Date(Date.now() - 86400e3) }) === false);

// ===== 2. Báo giá → chốt đơn =====
console.log("2) Báo giá: không đụng kho — chốt mới trừ kho + ghi nợ");
const [quote] = await db.insert(orders).values({
  code: "BG-1", status: "quote", paymentStatus: "unpaid",
  customerId: cust.id, warehouseId: wh.id,
  subtotal: money(8_700_000), total: money(8_700_000), amountPaid: money(0),
}).returning();
await db.insert(orderItems).values({
  orderId: quote.id, productId: p.id, productName: p.name,
  unitName: "bao", unitMultiplier: qty(1), quantity: qty(100), unitPrice: money(87000), total: money(8_700_000),
});
let [sl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
ok("tạo báo giá: kho giữ nguyên 1000", Number(sl.quantity) === 1000);
let [c] = await db.select().from(customers).where(eq(customers.id, cust.id));
ok("tạo báo giá: nợ = 0", Number(c.currentDebt) === 0);

// convert mirror
await db.transaction(async (tx) => {
  const [o] = await tx.select().from(orders).where(eq(orders.id, quote.id));
  if (o.status !== "quote") throw new Error("NOT_A_QUOTE");
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  await tx.update(orders).set({ code: "DH-C1", status: "completed" }).where(eq(orders.id, o.id));
  for (const i of items) {
    const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
    await tx.update(stockLevels).set({ quantity: dsql`${stockLevels.quantity} - ${qty(baseQty)}` })
      .where(dsql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${o.warehouseId}`);
    await tx.insert(stockMovements).values({ productId: i.productId, warehouseId: o.warehouseId, type: "sale", quantity: qty(-baseQty), refType: "order", refId: o.id });
  }
  await tx.update(customers).set({
    currentDebt: dsql`${customers.currentDebt} + ${o.total}`,
    totalSpent: dsql`${customers.totalSpent} + ${o.total}`,
  }).where(eq(customers.id, o.customerId));
});
[sl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
ok("chốt báo giá: kho 1000 − 100 = 900", Number(sl.quantity) === 900, `got ${sl.quantity}`);
[c] = await db.select().from(customers).where(eq(customers.id, cust.id));
ok("chốt báo giá: nợ = 8,7tr", Number(c.currentDebt) === 8_700_000);

// ===== 3. Sửa đơn =====
console.log("3) Sửa đơn: 100 bao → 80 bao (delta kho + nợ)");
await db.transaction(async (tx) => {
  const [o] = await tx.select().from(orders).where(eq(orders.id, quote.id));
  const oldItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  // hoàn kho cũ
  for (const i of oldItems) {
    const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
    await tx.update(stockLevels).set({ quantity: dsql`${stockLevels.quantity} + ${qty(baseQty)}` })
      .where(dsql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${o.warehouseId}`);
  }
  await tx.delete(orderItems).where(eq(orderItems.orderId, o.id));
  // dòng mới: 80 bao
  const newTotal = 80 * 87000;
  await tx.insert(orderItems).values({
    orderId: o.id, productId: p.id, productName: p.name,
    unitName: "bao", unitMultiplier: qty(1), quantity: qty(80), unitPrice: money(87000), total: money(newTotal),
  });
  await tx.update(stockLevels).set({ quantity: dsql`${stockLevels.quantity} - 80` })
    .where(dsql`${stockLevels.productId} = ${p.id} and ${stockLevels.warehouseId} = ${o.warehouseId}`);
  const deltaTotal = newTotal - Number(o.total);
  await tx.update(customers).set({
    currentDebt: dsql`greatest(${customers.currentDebt} + ${money(deltaTotal)}, 0)`,
    totalSpent: dsql`greatest(${customers.totalSpent} + ${money(deltaTotal)}, 0)`,
  }).where(eq(customers.id, o.customerId));
  await tx.update(orders).set({ subtotal: money(newTotal), total: money(newTotal) }).where(eq(orders.id, o.id));
});
[sl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
ok("kho sau sửa: 900 + 100 − 80 = 920", Number(sl.quantity) === 920, `got ${sl.quantity}`);
[c] = await db.select().from(customers).where(eq(customers.id, cust.id));
ok("nợ sau sửa: 80×87.000 = 6,96tr", Number(c.currentDebt) === 6_960_000, `got ${c.currentDebt}`);

// ===== 4. Gộp đơn =====
console.log("4) Gộp 2 đơn cùng khách");
const mk = async (code, qtyN, paidAmt) => {
  const total = qtyN * 87000;
  const [o] = await db.insert(orders).values({
    code, status: "completed", paymentStatus: paidAmt >= total ? "paid" : paidAmt > 0 ? "partial" : "unpaid",
    customerId: cust.id, warehouseId: wh.id,
    subtotal: money(total), total: money(total), amountPaid: money(paidAmt),
  }).returning();
  await db.insert(orderItems).values({
    orderId: o.id, productId: p.id, productName: p.name,
    unitName: "bao", unitMultiplier: qty(1), quantity: qty(qtyN), unitPrice: money(87000), total: money(total),
  });
  if (paidAmt > 0) await db.insert(payments).values({ orderId: o.id, amount: money(paidAmt), method: "cash" });
  return o;
};
const oA = await mk("DH-M1", 10, 870000);
const oB = await mk("DH-M2", 20, 0);
const idsM = [oA.id, oB.id];

const merged = await db.transaction(async (tx) => {
  const sources = await tx.select().from(orders).where(inArray(orders.id, idsM));
  const total = sources.reduce((s, o) => s + Number(o.total), 0);
  const paid = sources.reduce((s, o) => s + Number(o.amountPaid), 0);
  const [m] = await tx.insert(orders).values({
    code: "DHG-1", status: "completed",
    paymentStatus: paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid",
    customerId: cust.id, warehouseId: wh.id,
    subtotal: money(total), total: money(total), amountPaid: money(paid),
    note: `Gộp từ: ${sources.map((o) => o.code).join(", ")}`,
  }).returning();
  await tx.update(orderItems).set({ orderId: m.id }).where(inArray(orderItems.orderId, idsM));
  await tx.update(payments).set({ orderId: m.id }).where(inArray(payments.orderId, idsM));
  await tx.update(orders).set({ status: "merged" }).where(inArray(orders.id, idsM));
  return m;
});
const mergedItems = await db.select().from(orderItems).where(eq(orderItems.orderId, merged.id));
ok("đơn gộp nhận 2 dòng hàng", mergedItems.length === 2);
const mergedPays = await db.select().from(payments).where(eq(payments.orderId, merged.id));
ok("payment chuyển sang đơn gộp", mergedPays.length === 1 && Number(mergedPays[0].amount) === 870000);
ok("tổng gộp = 30×87.000, partial", Number(merged.total) === 2_610_000 && merged.paymentStatus === "partial");
const [oA2] = await db.select().from(orders).where(eq(orders.id, oA.id));
ok("đơn gốc → merged", oA2.status === "merged");
[sl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
ok("gộp không đụng kho (vẫn 920)", Number(sl.quantity) === 920, `got ${sl.quantity}`);

// ===== 5. Sổ quỹ =====
console.log("5) Sổ quỹ: số dư theo quỹ");
await db.insert(cashTransactions).values([
  { code: "PT-1", type: "in", fund: "cash", amount: money(5_000_000), category: "sale" },
  { code: "PT-2", type: "in", fund: "bank", amount: money(12_000_000), category: "debt_collect" },
  { code: "PC-1", type: "out", fund: "cash", amount: money(2_000_000), category: "expense", note: "thuê xe" },
  { code: "PC-2", type: "out", fund: "bank", amount: money(4_500_000), category: "supplier_payment" },
]);
const balances = await db
  .select({
    fund: cashTransactions.fund,
    balance: dsql`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)`,
  })
  .from(cashTransactions)
  .groupBy(cashTransactions.fund);
const bal = Object.fromEntries(balances.map((b) => [b.fund, Number(b.balance)]));
ok("quỹ TM: 5tr − 2tr = 3tr", bal.cash === 3_000_000, `got ${bal.cash}`);
ok("quỹ bank: 12tr − 4,5tr = 7,5tr", bal.bank === 7_500_000, `got ${bal.bank}`);

// ===== 6. Portal: giá theo nhóm + token =====
console.log("6) Portal: token + giá theo nhóm khách");
const [found] = await db.select().from(customers).where(eq(customers.portalToken, "tok_0123456789abcdef0123"));
ok("tìm khách theo token", found?.id === cust.id);
const priceFor = (prod, type) => {
  const pick = type === "wholesale" ? prod.wholesalePrice : type === "contractor" ? prod.contractorPrice : type === "agent" ? prod.agentPrice : null;
  return Number(pick ?? prod.retailPrice);
};
ok("giá thầu 87.000 (không phải giá lẻ)", priceFor(p, "contractor") === 87000);
ok("nhóm thiếu giá → fallback giá lẻ", priceFor(p, "wholesale") === 92000);

// ===== 7. Doanh thu loại quote/merged (fix double-count) =====
console.log("7) Doanh thu chỉ tính completed/returned");
// hiện có: DH-C1 (completed, 6.96tr sau sửa), DH-M1+DH-M2 (merged), DHG-1 (completed 2.61tr)
// thêm 1 quote nữa để chắc chắn bị loại
await db.insert(orders).values({
  code: "BG-X", status: "quote", paymentStatus: "unpaid",
  customerId: cust.id, warehouseId: wh.id,
  subtotal: money(99_000_000), total: money(99_000_000), amountPaid: money(0),
});
const { gte, inArray: inArr } = await import("drizzle-orm");
const today0 = new Date(); today0.setHours(0, 0, 0, 0);
const [rev] = await db.select({
  revenue: dsql`coalesce(sum(${orders.total}), 0)`,
  cnt: dsql`count(*)::int`,
}).from(orders).where(and(inArr(orders.status, ["completed", "returned"]), gte(orders.createdAt, today0)));
ok("doanh thu = 6,96tr + 2,61tr (loại quote 99tr + 2 đơn merged)",
  Number(rev.revenue) === 9_570_000 && rev.cnt === 2, `got ${rev.revenue}/${rev.cnt}`);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

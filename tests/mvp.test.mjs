/* Full MVP smoke test on PGlite — mirrors action logic 1:1 (minus auth/revalidate).
   Covers: createProduct, createOrder (deposit), addPayment, credit order, cancelOrder,
   createPurchase, list/aggregate queries (orders/customers/inventory/dashboard/reports). */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, desc, eq, gte, ne, or, sql as dsql } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const {
  products, productUnits, stockLevels, stockMovements, warehouses, categories, brands,
  customers, suppliers, orders, orderItems, payments, purchaseOrders, purchaseOrderItems,
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

// ============ setup: migration + seed ============
console.log("0) Migration + seed");
const { readdirSync } = await import("node:fs");
for (const f of readdirSync(`${PROJ}/drizzle`).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of readFileSync(`${PROJ}/drizzle/${f}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s && !/create extension/i.test(s)) await client.exec(s); // PGlite khong co unaccent
  }
}
const [wh] = await db.insert(warehouses).values({ name: "Kho chính", isDefault: true }).returning();
const [catGach] = await db.insert(categories).values({ name: "Gạch ốp lát" }).returning();
const [catXM] = await db.insert(categories).values({ name: "Xi măng" }).returning();
await db.insert(brands).values({ name: "Đồng Tâm" });

// 2 products: gạch (multi-unit, m2) + xi măng
const [gach] = await db.insert(products).values({
  sku: "DT6060", name: "Gạch lát 60×60 Đồng Tâm", categoryId: catGach.id, baseUnit: "viên",
  costPrice: money(57750), retailPrice: money(72000), contractorPrice: money(66000),
  m2PerUnit: "0.3600",
}).returning();
await db.insert(productUnits).values([
  { productId: gach.id, unitName: "hộp", multiplier: qty(4), priceOverride: money(285000), sortOrder: 0 },
]);
const [xm] = await db.insert(products).values({
  sku: "HT-PCB40", name: "Xi măng Hà Tiên PCB40", categoryId: catXM.id, baseUnit: "bao",
  costPrice: money(84500), retailPrice: money(92000), contractorPrice: money(87000),
}).returning();
for (const [pid, q, min] of [[gach.id, 500, 100], [xm.id, 200, 100]]) {
  await db.insert(stockLevels).values({ productId: pid, warehouseId: wh.id, quantity: qty(q), minLevel: qty(min) });
}
const [tuan] = await db.insert(customers).values({
  code: "KH-001", name: "Anh Tuấn", type: "contractor", debtLimit: money(60_000_000),
}).returning();
const [ncc] = await db.insert(suppliers).values({ code: "NCC-001", name: "Hà Tiên 1" }).returning();
ok("seed done", !!wh.id && !!gach.id && !!tuan.id);

// ============ createOrder — mirrors src/lib/actions/orders.ts ============
async function createOrder(v) {
  const subtotal = v.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const total = Math.max(0, subtotal - (v.discount ?? 0) + (v.shippingFee ?? 0));
  const paid = v.payment.method === "credit" ? 0 : Math.min(v.payment.amount, total);
  const remaining = total - paid;
  const paymentStatus = paid >= total ? "paid" : paid > 0 ? "deposit" : "unpaid";

  return db.transaction(async (tx) => {
    const [order] = await tx.insert(orders).values({
      code: v.code, status: "completed", paymentStatus,
      customerId: v.customerId ?? null, warehouseId: v.warehouseId,
      projectName: v.projectName || null,
      subtotal: money(subtotal), discount: money(v.discount ?? 0),
      shippingFee: money(v.shippingFee ?? 0), total: money(total), amountPaid: money(paid),
    }).returning();

    await tx.insert(orderItems).values(v.items.map((i) => ({
      orderId: order.id, productId: i.productId, productName: i.productName,
      unitName: i.unitName, unitMultiplier: qty(i.unitMultiplier),
      quantity: qty(i.quantity), unitPrice: money(i.unitPrice), total: money(i.quantity * i.unitPrice),
    })));

    if (paid > 0) {
      await tx.insert(payments).values({ orderId: order.id, amount: money(paid), method: v.payment.method });
    }

    for (const i of v.items) {
      const baseQty = i.quantity * i.unitMultiplier;
      await tx.insert(stockLevels).values({ productId: i.productId, warehouseId: v.warehouseId, quantity: qty(-baseQty) })
        .onConflictDoUpdate({
          target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
          set: { quantity: dsql`${stockLevels.quantity} - ${qty(baseQty)}`, updatedAt: dsql`now()` },
        });
      await tx.insert(stockMovements).values({
        productId: i.productId, warehouseId: v.warehouseId, type: "sale",
        quantity: qty(-baseQty), refType: "order", refId: order.id,
      });
    }

    if (v.customerId) {
      await tx.update(customers).set({
        currentDebt: dsql`${customers.currentDebt} + ${money(remaining)}`,
        totalSpent: dsql`${customers.totalSpent} + ${money(total)}`,
      }).where(eq(customers.id, v.customerId));
    }
    return order;
  });
}

console.log("1) POS: đơn cọc 50% (giá thầu, đơn vị hộp)");
// 20 hộp gạch giá thầu: override 285000 lẻ → ratio 66000/72000 → 261250/hộp (làm tròn như UI)
const hopPrice = Math.round(285000 * (66000 / 72000));
const order1 = await createOrder({
  code: "DH-TEST-1", customerId: tuan.id, warehouseId: wh.id, projectName: "Nhà a. Hùng",
  discount: 8000, shippingFee: 240000,
  items: [
    { productId: gach.id, productName: gach.name, unitName: "hộp", unitMultiplier: 4, quantity: 20, unitPrice: hopPrice },
    { productId: xm.id, productName: xm.name, unitName: "bao", unitMultiplier: 1, quantity: 50, unitPrice: 87000 },
  ],
  payment: { method: "cash", amount: Math.round((hopPrice * 20 + 87000 * 50 - 8000 + 240000) / 2) },
});

const expTotal = hopPrice * 20 + 87000 * 50 - 8000 + 240000;
ok(`order total = ${expTotal}`, Number(order1.total) === expTotal, `got ${order1.total}`);
ok("paymentStatus = deposit", order1.paymentStatus === "deposit");

const [slGach] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, gach.id), eq(stockLevels.warehouseId, wh.id)));
ok("gạch stock 500 − 20×4 = 420 viên", Number(slGach.quantity) === 420, `got ${slGach.quantity}`);
const [slXM] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, xm.id), eq(stockLevels.warehouseId, wh.id)));
ok("XM stock 200 − 50 = 150 bao", Number(slXM.quantity) === 150, `got ${slXM.quantity}`);

let [tuanRow] = await db.select().from(customers).where(eq(customers.id, tuan.id));
const expRemaining = expTotal - Math.round(expTotal / 2);
ok(`công nợ = phần còn lại (${expRemaining})`, Number(tuanRow.currentDebt) === expRemaining, `got ${tuanRow.currentDebt}`);
ok("totalSpent = tổng đơn", Number(tuanRow.totalSpent) === expTotal);

const moves1 = await db.select().from(stockMovements).where(eq(stockMovements.refId, order1.id));
ok("2 movements 'sale' âm", moves1.length === 2 && moves1.every((m) => m.type === "sale" && Number(m.quantity) < 0));

// ============ addPayment — mirrors action ============
console.log("2) Thu nợ phần còn lại");
await db.transaction(async (tx) => {
  const [o] = await tx.select().from(orders).where(eq(orders.id, order1.id));
  const total = Number(o.total), alreadyPaid = Number(o.amountPaid);
  const amount = Math.min(expRemaining, total - alreadyPaid);
  await tx.insert(payments).values({ orderId: o.id, amount: money(amount), method: "bank_transfer" });
  const newPaid = alreadyPaid + amount;
  await tx.update(orders).set({ amountPaid: money(newPaid), paymentStatus: newPaid >= total ? "paid" : "partial" }).where(eq(orders.id, o.id));
  await tx.update(customers).set({ currentDebt: dsql`greatest(${customers.currentDebt} - ${money(amount)}, 0)` }).where(eq(customers.id, o.customerId));
});
const [order1b] = await db.select().from(orders).where(eq(orders.id, order1.id));
ok("order → paid", order1b.paymentStatus === "paid" && Number(order1b.amountPaid) === expTotal);
[tuanRow] = await db.select().from(customers).where(eq(customers.id, tuan.id));
ok("công nợ về 0", Number(tuanRow.currentDebt) === 0, `got ${tuanRow.currentDebt}`);
const pays = await db.select().from(payments).where(eq(payments.orderId, order1.id));
ok("2 payment rows (cọc + thu nợ)", pays.length === 2);

// ============ credit order + cancel ============
console.log("3) Đơn ghi nợ toàn bộ rồi hủy");
const order2 = await createOrder({
  code: "DH-TEST-2", customerId: tuan.id, warehouseId: wh.id,
  items: [{ productId: xm.id, productName: xm.name, unitName: "bao", unitMultiplier: 1, quantity: 30, unitPrice: 87000 }],
  payment: { method: "credit", amount: 0 },
});
ok("đơn ghi nợ: unpaid", order2.paymentStatus === "unpaid");
[tuanRow] = await db.select().from(customers).where(eq(customers.id, tuan.id));
ok("nợ = 30×87000", Number(tuanRow.currentDebt) === 2_610_000, `got ${tuanRow.currentDebt}`);

// cancelOrder — mirrors action
await db.transaction(async (tx) => {
  const [o] = await tx.select().from(orders).where(eq(orders.id, order2.id));
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  for (const i of items) {
    const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
    await tx.update(stockLevels).set({ quantity: dsql`${stockLevels.quantity} + ${qty(baseQty)}` })
      .where(dsql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${o.warehouseId}`);
    await tx.insert(stockMovements).values({ productId: i.productId, warehouseId: o.warehouseId, type: "return_in", quantity: qty(baseQty), refType: "order_cancel", refId: o.id });
  }
  const remaining = Number(o.total) - Number(o.amountPaid);
  await tx.update(customers).set({
    currentDebt: dsql`greatest(${customers.currentDebt} - ${money(Math.max(0, remaining))}, 0)`,
    totalSpent: dsql`greatest(${customers.totalSpent} - ${o.total}, 0)`,
  }).where(eq(customers.id, o.customerId));
  await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, o.id));
});
const [slXM2] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, xm.id), eq(stockLevels.warehouseId, wh.id)));
ok("hủy đơn → kho hoàn lại 150 bao", Number(slXM2.quantity) === 150, `got ${slXM2.quantity}`);
[tuanRow] = await db.select().from(customers).where(eq(customers.id, tuan.id));
ok("hủy đơn → nợ về 0, totalSpent trừ lại", Number(tuanRow.currentDebt) === 0 && Number(tuanRow.totalSpent) === expTotal);

// ============ createPurchase — mirrors action ============
console.log("4) Nhập hàng (trả 1 phần, cập nhật giá vốn)");
const purchase = await db.transaction(async (tx) => {
  const items = [
    { productId: xm.id, quantity: 400, unitCost: 85000 },
    { productId: gach.id, quantity: 200, unitCost: 58000 },
  ];
  const total = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  const paid = 20_000_000;
  const owed = total - paid;
  const [po] = await tx.insert(purchaseOrders).values({
    code: "PN-TEST-1", supplierId: ncc.id, warehouseId: wh.id, status: "received",
    total: money(total), amountPaid: money(paid),
  }).returning();
  await tx.insert(purchaseOrderItems).values(items.map((i) => ({
    purchaseOrderId: po.id, productId: i.productId, quantity: qty(i.quantity), unitCost: money(i.unitCost), total: money(i.quantity * i.unitCost),
  })));
  for (const i of items) {
    await tx.insert(stockLevels).values({ productId: i.productId, warehouseId: wh.id, quantity: qty(i.quantity) })
      .onConflictDoUpdate({
        target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
        set: { quantity: dsql`${stockLevels.quantity} + ${qty(i.quantity)}` },
      });
    await tx.insert(stockMovements).values({ productId: i.productId, warehouseId: wh.id, type: "purchase", quantity: qty(i.quantity), unitCost: money(i.unitCost), refType: "purchase", refId: po.id });
    await tx.update(products).set({ costPrice: money(i.unitCost) }).where(eq(products.id, i.productId));
  }
  if (owed > 0) await tx.update(suppliers).set({ currentDebt: dsql`${suppliers.currentDebt} + ${money(owed)}` }).where(eq(suppliers.id, ncc.id));
  return { po, total, owed };
});
const [slXM3] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, xm.id), eq(stockLevels.warehouseId, wh.id)));
ok("XM stock 150 + 400 = 550", Number(slXM3.quantity) === 550, `got ${slXM3.quantity}`);
const [xm2] = await db.select().from(products).where(eq(products.id, xm.id));
ok("giá vốn XM cập nhật 85.000", Number(xm2.costPrice) === 85000);
const [ncc2] = await db.select().from(suppliers).where(eq(suppliers.id, ncc.id));
ok(`nợ NCC = ${purchase.owed}`, Number(ncc2.currentDebt) === purchase.owed, `got ${ncc2.currentDebt}`);

// ============ list/aggregate queries ============
console.log("5) Queries: orders/customer/inventory/dashboard/reports");

// orders owing filter (giống data/orders.ts)
const owing = await db.select({ id: orders.id }).from(orders)
  .leftJoin(customers, eq(orders.customerId, customers.id))
  .where(and(
    or(eq(orders.paymentStatus, "unpaid"), eq(orders.paymentStatus, "deposit"), eq(orders.paymentStatus, "partial")),
    eq(orders.status, "completed"),
  ));
ok("filter 'còn nợ' = 0 đơn (đã thu đủ / đã hủy)", owing.length === 0, `got ${owing.length}`);

// customer detail
const custOrders = await db.select().from(orders).where(eq(orders.customerId, tuan.id)).orderBy(desc(orders.createdAt));
ok("KH có 2 đơn lịch sử (1 hủy)", custOrders.length === 2 && custOrders.some((o) => o.status === "cancelled"));

// inventory aggregate + low stock (XM min 100, stock 550 → ok; gạch 420+800=... gạch: 500-80+200=620 viên, min 100 → ok)
const lowRows = await db.select({ id: products.id })
  .from(products)
  .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
  .where(eq(products.isActive, true))
  .groupBy(products.id)
  .having(dsql`coalesce(sum(${stockLevels.quantity}), 0) <= coalesce(max(${stockLevels.minLevel}), 0) and coalesce(max(${stockLevels.minLevel}), 0) > 0`);
ok("không SP nào dưới min sau nhập", lowRows.length === 0, `got ${lowRows.length}`);

// dashboard revenue today (chỉ tính đơn không hủy)
const today = new Date(); today.setHours(0, 0, 0, 0);
const [rev] = await db.select({
  revenue: dsql`coalesce(sum(${orders.total}), 0)`,
  cnt: dsql`count(*)::int`,
}).from(orders).where(and(ne(orders.status, "cancelled"), gte(orders.createdAt, today)));
ok(`doanh thu hôm nay = ${expTotal} (1 đơn, loại đơn hủy)`, Number(rev.revenue) === expTotal && rev.cnt === 1, `got ${rev.revenue}/${rev.cnt}`);

// reports: top products (revenue + profit) — profit dùng costPrice hiện tại
const top = await db.select({
  productId: orderItems.productId,
  revenue: dsql`sum(${orderItems.total})`,
  qtySold: dsql`sum(${orderItems.quantity} * ${orderItems.unitMultiplier})`,
})
  .from(orderItems)
  .innerJoin(orders, eq(orderItems.orderId, orders.id))
  .where(ne(orders.status, "cancelled"))
  .groupBy(orderItems.productId)
  .orderBy(desc(dsql`sum(${orderItems.total})`));
ok("top products: 2 SP, gạch đứng đầu", top.length === 2 && top[0].productId === gach.id, JSON.stringify(top.map(t => t.revenue)));
ok("gạch bán 80 viên (20 hộp × 4)", Number(top[0].qtySold) === 80, `got ${top[0].qtySold}`);

// by category
const byCat = await db.select({
  cat: dsql`coalesce(${categories.name}, 'Khác')`,
  revenue: dsql`sum(${orderItems.total})`,
})
  .from(orderItems)
  .innerJoin(orders, eq(orderItems.orderId, orders.id))
  .innerJoin(products, eq(orderItems.productId, products.id))
  .leftJoin(categories, eq(products.categoryId, categories.id))
  .where(ne(orders.status, "cancelled"))
  .groupBy(categories.name);
ok("doanh thu theo 2 danh mục", byCat.length === 2);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;

await client.close();

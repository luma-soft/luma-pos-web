/* Return-flow smoke test on PGlite — mirrors src/lib/actions/returns.ts logic. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const {
  products, stockLevels, stockMovements, warehouses, customers,
  orders, orderItems, returns, returnItems,
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

// ---- apply ALL migrations in order ----
console.log("0) Apply migrations (0000 + 0001)");
const migDir = `${PROJ}/drizzle`;
const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  for (const stmt of readFileSync(`${migDir}/${f}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s && !/create extension/i.test(s)) await client.exec(s); // PGlite khong co unaccent
  }
}
ok(`migrations applied: ${files.join(", ")}`, files.length >= 2);

// ---- seed + order ----
const [wh] = await db.insert(warehouses).values({ name: "Kho", isDefault: true }).returning();
const [p] = await db.insert(products).values({
  sku: "XM1", name: "Xi măng", baseUnit: "bao", costPrice: money(84500), retailPrice: money(92000),
}).returning();
await db.insert(stockLevels).values({ productId: p.id, warehouseId: wh.id, quantity: qty(100) });
const [cust] = await db.insert(customers).values({ code: "KH1", name: "Anh Tuấn", type: "contractor", debtLimit: money(50_000_000) }).returning();

// đơn ghi nợ 50 bao × 92.000 = 4.600.000
const [order] = await db.insert(orders).values({
  code: "DH-R1", status: "completed", paymentStatus: "unpaid",
  customerId: cust.id, warehouseId: wh.id,
  subtotal: money(4_600_000), total: money(4_600_000), amountPaid: money(0),
}).returning();
const [oi] = await db.insert(orderItems).values({
  orderId: order.id, productId: p.id, productName: p.name,
  unitName: "bao", unitMultiplier: qty(1), quantity: qty(50), unitPrice: money(92000), total: money(4_600_000),
}).returning();
await db.update(stockLevels).set({ quantity: dsql`${stockLevels.quantity} - 50` })
  .where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
await db.update(customers).set({
  currentDebt: money(4_600_000), totalSpent: money(4_600_000),
}).where(eq(customers.id, cust.id));

// ---- createReturn mirror ----
async function createReturn(v) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, v.orderId)).limit(1);
    if (!o) throw new Error("ORDER_NOT_FOUND");
    if (o.status === "cancelled") throw new Error("ORDER_CANCELLED");

    const itemIds = v.items.map((i) => i.orderItemId);
    const sourceItems = await tx.select().from(orderItems).where(inArray(orderItems.id, itemIds));
    const sourceById = new Map(sourceItems.map((i) => [i.id, i]));
    const prevReturned = await tx.select({
      orderItemId: returnItems.orderItemId,
      qty: dsql`coalesce(sum(${returnItems.quantity}), 0)`,
    }).from(returnItems).where(inArray(returnItems.orderItemId, itemIds)).groupBy(returnItems.orderItemId);
    const prevByItem = new Map(prevReturned.map((r) => [r.orderItemId, Number(r.qty)]));

    let totalRefund = 0;
    const rows = [];
    for (const i of v.items) {
      const src = sourceById.get(i.orderItemId);
      if (!src || src.orderId !== o.id) throw new Error("ITEM_NOT_IN_ORDER");
      const maxReturnable = Number(src.quantity) - (prevByItem.get(i.orderItemId) ?? 0);
      if (i.quantity > maxReturnable + 1e-9) throw new Error("QTY_EXCEEDS");
      const lineRefund = i.quantity * Number(src.unitPrice);
      totalRefund += lineRefund;
      rows.push({
        orderItemId: src.id, productId: src.productId, productName: src.productName,
        unitName: src.unitName, unitMultiplier: src.unitMultiplier,
        quantity: qty(i.quantity), unitPrice: src.unitPrice, total: money(lineRefund),
        restock: i.restock ?? true,
      });
    }

    if (v.refundMethod === "debt_deduct") {
      if (!o.customerId) throw new Error("DEBT_NEEDS_CUSTOMER");
      const [c] = await tx.select({ debt: customers.currentDebt }).from(customers).where(eq(customers.id, o.customerId)).limit(1);
      if (Number(c.debt) < totalRefund - 1e-9) throw new Error("DEBT_TOO_SMALL");
    }

    const [ret] = await tx.insert(returns).values({
      code: v.code, orderId: o.id, customerId: o.customerId, warehouseId: o.warehouseId,
      reason: v.reason, refundMethod: v.refundMethod, totalRefund: money(totalRefund),
    }).returning();
    await tx.insert(returnItems).values(rows.map((r) => ({ ...r, returnId: ret.id })));

    for (const r of rows.filter((x) => x.restock)) {
      const baseQty = Number(r.quantity) * Number(r.unitMultiplier);
      await tx.insert(stockLevels).values({ productId: r.productId, warehouseId: o.warehouseId, quantity: qty(baseQty) })
        .onConflictDoUpdate({
          target: [stockLevels.productId, stockLevels.warehouseId],
          set: { quantity: dsql`${stockLevels.quantity} + ${qty(baseQty)}` },
        });
      await tx.insert(stockMovements).values({
        productId: r.productId, warehouseId: o.warehouseId, type: "return_in",
        quantity: qty(baseQty), refType: "return", refId: ret.id,
      });
    }

    if (o.customerId) {
      if (v.refundMethod === "debt_deduct") {
        await tx.update(customers).set({
          currentDebt: dsql`greatest(${customers.currentDebt} - ${money(totalRefund)}, 0)`,
          totalSpent: dsql`greatest(${customers.totalSpent} - ${money(totalRefund)}, 0)`,
        }).where(eq(customers.id, o.customerId));
      } else {
        await tx.update(customers).set({
          totalSpent: dsql`greatest(${customers.totalSpent} - ${money(totalRefund)}, 0)`,
        }).where(eq(customers.id, o.customerId));
      }
    }

    const allItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    const allReturned = await tx.select({
      orderItemId: returnItems.orderItemId,
      qty: dsql`coalesce(sum(${returnItems.quantity}), 0)`,
    }).from(returnItems).innerJoin(orderItems, eq(returnItems.orderItemId, orderItems.id))
      .where(eq(orderItems.orderId, o.id)).groupBy(returnItems.orderItemId);
    const returnedByItem = new Map(allReturned.map((r) => [r.orderItemId, Number(r.qty)]));
    const fullyReturned = allItems.every((i) => (returnedByItem.get(i.id) ?? 0) >= Number(i.quantity) - 1e-9);
    if (fullyReturned) await tx.update(orders).set({ status: "returned" }).where(eq(orders.id, o.id));

    return { ret, totalRefund };
  });
}

console.log("1) Trả 10 bao (restock, trừ nợ)");
const r1 = await createReturn({
  code: "TH-1", orderId: order.id, reason: "defective", refundMethod: "debt_deduct",
  items: [{ orderItemId: oi.id, quantity: 10, restock: true }],
});
ok("hoàn 10×92.000 = 920.000", r1.totalRefund === 920_000, `got ${r1.totalRefund}`);
let [sl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
ok("kho 50 + 10 = 60", Number(sl.quantity) === 60, `got ${sl.quantity}`);
let [c] = await db.select().from(customers).where(eq(customers.id, cust.id));
ok("nợ 4.600.000 − 920.000 = 3.680.000", Number(c.currentDebt) === 3_680_000, `got ${c.currentDebt}`);
ok("totalSpent trừ theo refund", Number(c.totalSpent) === 3_680_000);
const mv = await db.select().from(stockMovements).where(eq(stockMovements.refId, r1.ret.id));
ok("movement return_in +10", mv.length === 1 && Number(mv[0].quantity) === 10);

console.log("2) Trả vượt số còn lại → chặn");
let err = "";
try {
  await createReturn({
    code: "TH-2", orderId: order.id, reason: "other", refundMethod: "debt_deduct",
    items: [{ orderItemId: oi.id, quantity: 45 }],
  });
} catch (e) { err = e.message; }
ok("QTY_EXCEEDS (40 còn lại, đòi trả 45)", err === "QTY_EXCEEDS", err);

console.log("3) Trả nốt 40 bao — hàng hỏng không restock, hoàn TM");
const r2 = await createReturn({
  code: "TH-3", orderId: order.id, reason: "defective", refundMethod: "cash",
  items: [{ orderItemId: oi.id, quantity: 40, restock: false }],
});
ok("hoàn 40×92.000", r2.totalRefund === 3_680_000);
[sl] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, p.id), eq(stockLevels.warehouseId, wh.id)));
ok("kho giữ nguyên 60 (không restock)", Number(sl.quantity) === 60, `got ${sl.quantity}`);
[c] = await db.select().from(customers).where(eq(customers.id, cust.id));
ok("hoàn TM: nợ giữ nguyên 3.680.000", Number(c.currentDebt) === 3_680_000, `got ${c.currentDebt}`);
const [o2] = await db.select().from(orders).where(eq(orders.id, order.id));
ok("trả hết → order status 'returned'", o2.status === "returned", o2.status);

console.log("4) Trừ nợ vượt nợ hiện tại → chặn");
// đơn mới nhỏ, khách hết nợ → debt_deduct phải fail
const [order3] = await db.insert(orders).values({
  code: "DH-R3", status: "completed", paymentStatus: "paid",
  customerId: cust.id, warehouseId: wh.id,
  subtotal: money(92000 * 60), total: money(92000 * 60), amountPaid: money(92000 * 60),
}).returning();
const [oi3] = await db.insert(orderItems).values({
  orderId: order3.id, productId: p.id, productName: p.name,
  unitName: "bao", unitMultiplier: qty(1), quantity: qty(60), unitPrice: money(92000), total: money(92000 * 60),
}).returning();
await db.update(customers).set({ currentDebt: money(0) }).where(eq(customers.id, cust.id));
err = "";
try {
  await createReturn({
    code: "TH-4", orderId: order3.id, reason: "other", refundMethod: "debt_deduct",
    items: [{ orderItemId: oi3.id, quantity: 60 }],
  });
} catch (e) { err = e.message; }
ok("DEBT_TOO_SMALL khi nợ 0", err === "DEBT_TOO_SMALL", err);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

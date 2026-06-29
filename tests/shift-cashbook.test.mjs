/* Shift/cashbook smoke test on PGlite.
   Covers nullable shift links, shift-scoped expected cash, tender totals, and order counts. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql as dsql } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const {
  profiles,
  shifts,
  orders,
  payments,
  cashTransactions,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const money = (n) => n.toFixed(2);

console.log("0) Apply all migrations");
const migDir = `${PROJ}/drizzle`;
const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  for (const stmt of readFileSync(`${migDir}/${f}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s && !/create extension/i.test(s)) await client.exec(s);
  }
}
ok("migration adds orders.shiftId", "shiftId" in orders);
ok("migration adds payments.shiftId", "shiftId" in payments);
ok("migration adds cashTransactions.shiftId", "shiftId" in cashTransactions);

console.log("1) Shift-scoped cash and tender totals");
const [cashier] = await db.insert(profiles).values({
  id: "00000000-0000-0000-0000-000000000001",
  fullName: "Cashier One",
  role: "cashier",
}).returning();
const [otherCashier] = await db.insert(profiles).values({
  id: "00000000-0000-0000-0000-000000000002",
  fullName: "Cashier Two",
  role: "cashier",
}).returning();

const [shift] = await db.insert(shifts).values({
  code: "CA-1",
  userId: cashier.id,
  openingFloat: money(1_000_000),
  status: "open",
}).returning();
const [otherShift] = await db.insert(shifts).values({
  code: "CA-2",
  userId: otherCashier.id,
  openingFloat: money(2_000_000),
  status: "open",
}).returning();

const [cashOrder] = await db.insert(orders).values({
  code: "DH-CASH",
  status: "completed",
  paymentStatus: "paid",
  shiftId: shift.id,
  subtotal: money(700_000),
  total: money(700_000),
  amountPaid: money(700_000),
  createdBy: cashier.id,
}).returning();
const [creditOrder] = await db.insert(orders).values({
  code: "DH-CREDIT",
  status: "completed",
  paymentStatus: "unpaid",
  shiftId: shift.id,
  subtotal: money(500_000),
  total: money(500_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();

await db.insert(payments).values([
  {
    orderId: cashOrder.id,
    shiftId: shift.id,
    amount: money(400_000),
    method: "cash",
    reference: "TM-001",
    createdBy: cashier.id,
  },
  {
    orderId: cashOrder.id,
    shiftId: shift.id,
    amount: money(300_000),
    method: "bank_transfer",
    reference: "BANK-001",
    createdBy: cashier.id,
  },
]);
await db.insert(cashTransactions).values([
  { code: "PT-SALE", shiftId: shift.id, type: "in", fund: "cash", amount: money(400_000), category: "sale", refType: "order", refId: cashOrder.id, createdBy: cashier.id },
  { code: "PC-EXP", shiftId: shift.id, type: "out", fund: "cash", amount: money(50_000), category: "expense", refType: "manual", createdBy: cashier.id },
  { code: "PT-OLD", type: "in", fund: "cash", amount: money(9_999_999), category: "other", refType: "manual", createdBy: cashier.id },
  { code: "PT-OTHER-SHIFT", shiftId: otherShift.id, type: "in", fund: "cash", amount: money(888_888), category: "sale", refType: "manual", createdBy: otherCashier.id },
]);

const [cashAgg] = await db
  .select({
    net: dsql`coalesce(sum(case when ${cashTransactions.type} = 'in' then ${cashTransactions.amount} else -${cashTransactions.amount} end), 0)`,
  })
  .from(cashTransactions)
  .where(dsql`${cashTransactions.shiftId} = ${shift.id} and ${cashTransactions.fund} = 'cash'`);
const expectedCash = Number(shift.openingFloat) + Number(cashAgg.net);
ok("expected cash ignores legacy/no-shift and other shift tx", expectedCash === 1_350_000, `got ${expectedCash}`);

const tenderRows = await db
  .select({
    method: payments.method,
    total: dsql`coalesce(sum(${payments.amount}), 0)`,
  })
  .from(payments)
  .where(eq(payments.shiftId, shift.id))
  .groupBy(payments.method);
const tender = Object.fromEntries(tenderRows.map((row) => [row.method, Number(row.total)]));
ok("cash tender = 400k", tender.cash === 400_000, `got ${tender.cash}`);
ok("bank transfer tender = 300k", tender.bank_transfer === 300_000, `got ${tender.bank_transfer}`);

const [orderAgg] = await db
  .select({ count: dsql`count(*)::int` })
  .from(orders)
  .where(eq(orders.shiftId, shift.id));
ok("order count includes credit/no-payment order", Number(orderAgg.count) === 2, `got ${orderAgg.count}`);
ok("payment reference is stored", (await db.select().from(payments).where(eq(payments.reference, "BANK-001"))).length === 1);
ok("credit order has no payment row but remains in shift", !!creditOrder.id);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const { addManualPaymentCore } = await import(
  `${PROJ}/src/lib/orders/payment-core.ts`
);
const {
  cashTransactions,
  customers,
  notificationEvents,
  orders,
  payments,
  profiles,
} = schema;
const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");

for (const file of readdirSync(`${PROJ}/drizzle`)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  for (const statement of readFileSync(`${PROJ}/drizzle/${file}`, "utf8").split(
    "--> statement-breakpoint",
  )) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}
const [actor] = await db.insert(profiles).values({
  id: "10000000-0000-4000-8000-000000000001",
  fullName: "Manual payment actor",
  role: "cashier",
}).returning();
const [customer] = await db.insert(customers).values({
  code: "KH-IDEMPOTENT-001",
  name: "Manual payment customer",
  currentDebt: "200000",
}).returning();
const [order] = await db
  .insert(orders)
  .values({
    code: "HD-IDEMPOTENT-001",
    status: "completed",
    paymentStatus: "partial",
    subtotal: "300000",
    total: "300000",
    amountPaid: "100000",
    customerId: customer.id,
  })
  .returning();

const request = {
  orderId: order.id,
  amount: 100000,
  method: "card",
  clientRequestId: `manual:${order.id}:1:card`,
};
const first = await addManualPaymentCore(db, request, {
  profileId: actor.id,
  shiftId: null,
});
const replay = await addManualPaymentCore(db, request, {
  profileId: actor.id,
  shiftId: null,
});

const paymentRows = await db
  .select()
  .from(payments)
  .where(eq(payments.orderId, order.id));
const cashRows = await db
  .select()
  .from(cashTransactions)
  .where(eq(cashTransactions.refId, order.id));
const [updatedOrder] = await db
  .select()
  .from(orders)
  .where(eq(orders.id, order.id));
const debtEvents = await db
  .select()
  .from(notificationEvents)
  .where(and(
    eq(notificationEvents.category, "debtChanged"),
    eq(notificationEvents.entityId, customer.id),
  ));

if (!first.ok || !replay.ok || replay.data.replayed !== true) {
  throw new Error("manual payment replay was not accepted idempotently");
}
if (paymentRows.length !== 1 || cashRows.length !== 1) {
  throw new Error("manual payment replay duplicated financial records");
}
if (Number(updatedOrder.amountPaid) !== 200000) {
  throw new Error("manual payment replay changed order amount more than once");
}
if (debtEvents.length !== 1) {
  throw new Error(`manual debt payment must emit one event, got ${debtEvents.length}`);
}
if (
  debtEvents[0].eventKey
    !== `debt-changed:customer:${customer.id}:manual_payment:${request.clientRequestId}`
  || debtEvents[0].metadata?.delta !== -100000
) {
  throw new Error(`manual debt event is not deterministic: ${JSON.stringify(debtEvents[0])}`);
}
if (
  !first.ok
  || first.data.replayed
  || !first.data.notificationEventId
  || !replay.ok
  || replay.data.notificationEventId !== undefined
) {
  throw new Error("manual payment notification result does not distinguish create from replay");
}

await client.close();
console.log("manual payment idempotency: 6 passed, 0 failed");

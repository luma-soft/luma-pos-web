import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const { addManualPaymentCore } = await import(
  `${PROJ}/src/lib/orders/payment-core.ts`
);
const { cashTransactions, orders, payments } = schema;
const client = new PGlite();
const db = drizzle(client, { schema });

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

const [order] = await db
  .insert(orders)
  .values({
    code: "HD-IDEMPOTENT-001",
    status: "completed",
    paymentStatus: "partial",
    subtotal: "300000",
    total: "300000",
    amountPaid: "100000",
  })
  .returning();

const request = {
  orderId: order.id,
  amount: 100000,
  method: "card",
  clientRequestId: `manual:${order.id}:1:card`,
};
const first = await addManualPaymentCore(db, request, {
  profileId: null,
  shiftId: null,
});
const replay = await addManualPaymentCore(db, request, {
  profileId: null,
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

if (!first.ok || !replay.ok || replay.data.replayed !== true) {
  throw new Error("manual payment replay was not accepted idempotently");
}
if (paymentRows.length !== 1 || cashRows.length !== 1) {
  throw new Error("manual payment replay duplicated financial records");
}
if (Number(updatedOrder.amountPaid) !== 200000) {
  throw new Error("manual payment replay changed order amount more than once");
}

await client.close();
console.log("manual payment idempotency: 3 passed, 0 failed");

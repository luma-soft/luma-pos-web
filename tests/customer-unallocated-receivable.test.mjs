import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const project = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const STORE_ID = "00000000-0000-4000-8000-000000000001";
const schema = await import(`${project}/src/db/schema.ts`);
const { collectCustomerReceivable } = await import(
  `${project}/src/lib/receivables/service-core.ts`
);

const client = new PGlite();
const database = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${project}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${project}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const migration = statement.trim();
    if (migration && !/create extension|gin_trgm_ops/i.test(migration)) {
      await client.exec(migration);
    }
  }
}

const [customer] = await database
  .insert(schema.customers)
  .values({ code: "KH-UNALLOCATED", name: "Khách nợ chưa gắn đơn", currentDebt: "500.00" })
  .returning({ id: schema.customers.id });

const result = await collectCustomerReceivable(database, {
  customerId: customer.id,
  amount: 200,
  method: "cash",
  allocations: [],
  clientRequestId: "customer-unallocated-001",
}, { storeId: STORE_ID, profileId: null, shiftId: null });

assert.equal(result.ok, true);
const [updated] = await database
  .select({ currentDebt: schema.customers.currentDebt })
  .from(schema.customers)
  .where(eq(schema.customers.id, customer.id));
assert.equal(Number(updated.currentDebt), 300);
const [allocationCount] = await database
  .select({ count: sql`count(*)::int` })
  .from(schema.customerReceivableAllocations);
assert.equal(Number(allocationCount.count), 0);
const [cashCount] = await database
  .select({ count: sql`count(*)::int` })
  .from(schema.cashTransactions);
assert.equal(Number(cashCount.count), 1);

const advance = await collectCustomerReceivable(database, {
  customerId: customer.id,
  amount: 400,
  method: "bank_transfer",
  allocations: [],
  clientRequestId: "customer-unallocated-advance-002",
}, { storeId: STORE_ID, profileId: null, shiftId: null });
assert.equal(advance.ok, true);
const [afterAdvance] = await database
  .select({ currentDebt: schema.customers.currentDebt })
  .from(schema.customers)
  .where(eq(schema.customers.id, customer.id));
assert.equal(Number(afterAdvance.currentDebt), -100);

console.log("customer unallocated receivable test passed");

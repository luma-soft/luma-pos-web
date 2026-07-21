import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const project = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${project}/src/db/schema.ts`);
const { getReceivablesSnapshot } = await import(`${project}/src/lib/finance/receivables.ts`);

const client = new PGlite();
const database = drizzle(client, { schema });

for (const file of readdirSync(`${project}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${project}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

await database.insert(schema.customers).values([
  {
    code: "DEBTOR",
    name: "Current debtor",
    totalSpent: "1000.00",
    currentDebt: "200.00",
  },
  {
    code: "PAID",
    name: "Paid customer",
    totalSpent: "500.00",
    currentDebt: "0.00",
  },
]);

assert.deepEqual(await getReceivablesSnapshot(database), {
  total: 1500,
  paid: 1300,
  unpaid: 200,
  count: 1,
});

console.log("finance receivables snapshot test passed");

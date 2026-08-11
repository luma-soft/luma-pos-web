import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const project = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${project}/src/db/schema.ts`);
const { getReportsForDatabase } = await import(`${project}/src/lib/data/reports.ts`);
const STORE_ID = "00000000-0000-4000-8000-000000000001";

const client = new PGlite();
const database = drizzle(client, { schema });

await client.exec("create role anon; create role authenticated;");

for (const file of readdirSync(`${project}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${project}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension|gin_trgm_ops/i.test(sql)) await client.exec(sql);
  }
}

const [revenueProduct, freeProduct] = await database.insert(schema.products).values([
  {
    sku: "REPORT-PAID-LINE",
    name: "Paid service",
    baseUnit: "lần",
    costPrice: "0.00",
    retailPrice: "275000.00",
  },
  {
    sku: "REPORT-FREE-LINE",
    name: "Free bracket",
    baseUnit: "cái",
    costPrice: "7000.00",
    retailPrice: "15000.00",
  },
]).returning();

const [order] = await database.insert(schema.orders).values({
  code: "REPORT-FREE-LINE-ORDER",
  status: "completed",
  paymentStatus: "paid",
  subtotal: "275000.00",
  total: "275000.00",
  amountPaid: "275000.00",
}).returning();

await database.insert(schema.orderItems).values([
  {
    orderId: order.id,
    productId: revenueProduct.id,
    productName: revenueProduct.name,
    unitName: revenueProduct.baseUnit,
    unitMultiplier: "1.0000",
    quantity: "1.0000",
    unitPrice: "275000.00",
    total: "275000.00",
  },
  {
    orderId: order.id,
    productId: freeProduct.id,
    productName: freeProduct.name,
    unitName: freeProduct.baseUnit,
    unitMultiplier: "1.0000",
    quantity: "1.0000",
    unitPrice: "0.00",
    total: "0.00",
  },
]);

const report = await getReportsForDatabase(database, STORE_ID, 1);
const free = report.topProducts.find((row) => row.productName === "Free bracket");

assert.equal(report.summary.revenue, 275000);
assert.equal(report.summary.grossProfit, 268000);
assert.ok(free, "free product remains represented in product sales reporting");
assert.equal(Number(free.qtySold), 1);
assert.equal(Number(free.revenue), 0);
assert.equal(Number(free.profit), -7000);

console.log("report free-line integration test passed");

await client.close();

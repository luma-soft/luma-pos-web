import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const project = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${project}/src/db/schema.ts`);
const { getReportsForDatabase } = await import(`${project}/src/lib/data/reports.ts`);

const client = new PGlite();
const database = drizzle(client, { schema });

for (const file of readdirSync(`${project}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${project}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const [product] = await database.insert(schema.products).values({
  sku: "REPORT-RETURN",
  name: "Returned product",
  baseUnit: "item",
  costPrice: "40.00",
  retailPrice: "100.00",
}).returning();

const oldSaleDate = new Date();
oldSaleDate.setHours(12, 0, 0, 0);
oldSaleDate.setDate(oldSaleDate.getDate() - 2);

const [order] = await database.insert(schema.orders).values({
  code: "REPORT-OLD-SALE",
  status: "returned",
  paymentStatus: "paid",
  subtotal: "100.00",
  total: "100.00",
  amountPaid: "100.00",
  createdAt: oldSaleDate,
}).returning();

const [orderItem] = await database.insert(schema.orderItems).values({
  orderId: order.id,
  productId: product.id,
  productName: product.name,
  unitName: product.baseUnit,
  unitMultiplier: "1.0000",
  quantity: "1.0000",
  unitPrice: "100.00",
  total: "100.00",
}).returning();

const [returned] = await database.insert(schema.returns).values({
  code: "REPORT-TODAY-RETURN",
  orderId: order.id,
  totalRefund: "100.00",
}).returning();

await database.insert(schema.returnItems).values({
  returnId: returned.id,
  orderItemId: orderItem.id,
  productId: product.id,
  productName: product.name,
  unitName: product.baseUnit,
  unitMultiplier: "1.0000",
  quantity: "1.0000",
  unitPrice: "100.00",
  total: "100.00",
});

const report = await getReportsForDatabase(database, 1);
const today = new Date().toISOString().slice(0, 10);

assert.equal(report.summary.revenue, -100);
assert.equal(report.summary.grossProfit, -60);
assert.equal(report.summary.refundTotal, 100);
assert.deepEqual(report.byDay, [{ day: today, revenue: -100, orderCount: 0 }]);

console.log("report net-return integration test passed");

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const project = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ??= "postgres://lumapos-test:lumapos-test@127.0.0.1:5432/lumapos_test";
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

const [product] = await database.insert(schema.products).values({
  sku: "REPORT-SALE-DOCUMENT-TYPE",
  name: "Sale document type product",
  baseUnit: "cái",
  costPrice: "10.00",
  retailPrice: "100.00",
}).returning();

const [sale, booking] = await database.insert(schema.orders).values([
  {
    code: "REPORT-SALE-DOCUMENT",
    documentType: "sale",
    status: "completed",
    paymentStatus: "paid",
    subtotal: "100.00",
    total: "100.00",
    amountPaid: "100.00",
  },
  {
    code: "REPORT-BOOKING-SNAPSHOT",
    documentType: "booking",
    status: "completed",
    paymentStatus: "paid",
    subtotal: "100.00",
    total: "100.00",
    amountPaid: "100.00",
  },
]).returning();

await database.insert(schema.orderItems).values([
  {
    orderId: sale.id,
    productId: product.id,
    productName: product.name,
    unitName: product.baseUnit,
    unitMultiplier: "1.0000",
    quantity: "1.0000",
    unitPrice: "100.00",
    total: "100.00",
  },
  {
    orderId: booking.id,
    productId: product.id,
    productName: product.name,
    unitName: product.baseUnit,
    unitMultiplier: "1.0000",
    quantity: "1.0000",
    unitPrice: "100.00",
    total: "100.00",
  },
]);

const report = await getReportsForDatabase(database, STORE_ID, 1, {}, {
  publicBucket: "public-media",
  publicBaseUrl: "https://media.staging.lumapos.test",
});

assert.equal(report.summary.revenue, 100);
assert.equal(report.summary.orderCount, 1);
assert.equal(Number(report.topProducts[0]?.revenue), 100);

console.log("report sale-document-type integration test passed");

await client.close();

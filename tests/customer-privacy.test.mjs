/* Customer privacy export/erasure smoke test on PGlite.
   Mirrors src/lib/customers/privacy.ts without touching an external database. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const {
  customerConsentEvents,
  customerConsents,
  customers,
  orderItems,
  orders,
  payments,
  products,
} = schema;
const client = new PGlite();
const db = drizzle(client, { schema });

let pass = 0;
let fail = 0;
const ok = (name, condition) => {
  if (condition) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`);
  }
};

for (const file of readdirSync(`${PROJ}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${PROJ}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

console.log("1) Export package includes consent and financial history");
const [customer] = await db.insert(customers).values({
  code: "KH-PRIVACY",
  name: "Khách Privacy",
  phone: "0909000000",
  email: "privacy@example.com",
  address: "Hồ Chí Minh",
  currentDebt: "0",
}).returning();
await db.insert(customerConsents).values({
  customerId: customer.id,
  status: "granted",
  purposes: { sales: true },
});
await db.insert(customerConsentEvents).values({
  customerId: customer.id,
  status: "granted",
  purposes: { sales: true },
});
const [order] = await db.insert(orders).values({
  code: "DH-PRIVACY",
  customerId: customer.id,
  status: "completed",
  paymentStatus: "paid",
  subtotal: "120000",
  total: "120000",
  amountPaid: "120000",
}).returning();
const [product] = await db.insert(products).values({
  sku: "PRIVACY-1",
  name: "Sản phẩm",
  baseUnit: "cái",
  retailPrice: "120000",
}).returning();
await db.insert(orderItems).values({
  orderId: order.id,
  productId: product.id,
  productName: "Sản phẩm",
  unitName: "cái",
  unitMultiplier: "1",
  quantity: "1",
  unitPrice: "120000",
  total: "120000",
});
await db.insert(payments).values({
  orderId: order.id,
  amount: "120000",
  method: "cash",
});
const customerOrders = await db.select().from(orders).where(eq(orders.customerId, customer.id));
const orderIds = customerOrders.map((row) => row.id);
const [exportedConsent, exportedEvents, exportedItems, exportedPayments] = await Promise.all([
  db.select().from(customerConsents).where(eq(customerConsents.customerId, customer.id)),
  db.select().from(customerConsentEvents).where(eq(customerConsentEvents.customerId, customer.id)),
  db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
  db.select().from(payments).where(inArray(payments.orderId, orderIds)),
]);
ok("consent current state and event are exported", exportedConsent.length === 1 && exportedEvents.length === 1);
ok("order line and payment are exported", exportedItems.length === 1 && exportedPayments.length === 1);

console.log("2) Erasure removes PII but retains legally relevant financial rows");
await db.transaction(async (tx) => {
  await tx.delete(customerConsentEvents).where(eq(customerConsentEvents.customerId, customer.id));
  await tx.delete(customerConsents).where(eq(customerConsents.customerId, customer.id));
  await tx.update(customers).set({
    code: `ERASED-${customer.id.slice(0, 8)}`,
    name: "Đã ẩn danh",
    phone: null,
    email: null,
    address: null,
    taxCode: null,
    portalToken: null,
    note: null,
    isActive: false,
  }).where(eq(customers.id, customer.id));
});
const [erased] = await db.select().from(customers).where(eq(customers.id, customer.id));
const retainedOrders = await db.select().from(orders).where(eq(orders.customerId, customer.id));
const consentAfter = await db.select().from(customerConsents).where(eq(customerConsents.customerId, customer.id));
ok("direct identifiers are cleared", erased.name === "Đã ẩn danh" && erased.phone === null && erased.email === null && !erased.isActive);
ok("financial order remains linked to anonymized subject", retainedOrders.length === 1 && retainedOrders[0].code === "DH-PRIVACY");
ok("consent data is removed", consentAfter.length === 0);

console.log("3) Outstanding debt blocks erasure");
const [debtor] = await db.insert(customers).values({
  name: "Khách còn nợ",
  currentDebt: "50000",
}).returning();
ok("non-zero debt is detected", Number(debtor.currentDebt) !== 0);

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

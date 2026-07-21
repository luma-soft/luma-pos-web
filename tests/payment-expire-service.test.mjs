/* eslint-disable no-console */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const service = await import(`${PROJ}/src/lib/payments/service-core.ts`);

const {
  profiles,
  shifts,
  warehouses,
  products,
  stockLevels,
  orders,
  orderItems,
  payments,
  paymentBankAccounts,
} = schema;

const money = (value) => value.toFixed(2);

const client = new PGlite();
const db = drizzle(client, { schema });

for (const file of readdirSync(`${PROJ}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${PROJ}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) {
      await client.exec(sql);
    }
  }
}

const [cashier] = await db.insert(profiles).values({
  id: "00000000-0000-4000-8000-000000000401",
  fullName: "Expire Cashier",
  role: "cashier",
}).returning();

const [shift] = await db.insert(shifts).values({
  code: "SHIFT-EXPIRE",
  userId: cashier.id,
  openingFloat: money(200_000),
}).returning();

const [warehouse] = await db.insert(warehouses).values({
  name: "Expire Warehouse",
}).returning();
const [product] = await db.insert(products).values({
  sku: "EXP-001",
  name: "Expire Product",
  retailPrice: money(125_000),
}).returning();
await db.insert(stockLevels).values({
  productId: product.id,
  warehouseId: warehouse.id,
  quantity: money(5),
});

const [bankAccount] = await db.insert(paymentBankAccounts).values({
  profileId: cashier.id,
  provider: "sepay",
  isDefault: true,
  enabled: true,
  bankCode: "VCB",
  accountNumber: "123456789",
  subAccount: "000",
  accountName: "Expire",
  gateway: "sepay",
}).returning();

const [orderForGateway] = await db.insert(orders).values({
  code: "DH-EXPIRE-GATEWAY",
  status: "draft",
  paymentStatus: "unpaid",
  shiftId: shift.id,
  warehouseId: warehouse.id,
  subtotal: money(125_000),
  total: money(125_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
await db.insert(orderItems).values({
  orderId: orderForGateway.id,
  productId: product.id,
  productName: product.name,
  unitName: "cái",
  unitMultiplier: money(1),
  quantity: money(1),
  unitPrice: money(125_000),
  total: money(125_000),
});

const [orderForSepay] = await db.insert(orders).values({
  code: "DH-EXPIRE-SEPAY",
  status: "draft",
  paymentStatus: "unpaid",
  shiftId: shift.id,
  warehouseId: warehouse.id,
  subtotal: money(90_000),
  total: money(90_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
await db.insert(orderItems).values({
  orderId: orderForSepay.id,
  productId: product.id,
  productName: product.name,
  unitName: "cái",
  unitMultiplier: money(1),
  quantity: money(1),
  unitPrice: money(90_000),
  total: money(90_000),
});

const createdGateway = await service.createPendingGatewayPayment(db, {
  orderId: orderForGateway.id,
  provider: "momo",
  amount: 125_000,
  reference: "LUMA-GATEWAY-EXPIRE",
  clientRequestId: "client-request-gateway-expire",
  createdBy: cashier.id,
});

const createdSepay = await service.createPendingSepayPayment(db, {
  orderId: orderForSepay.id,
  bankAccountId: bankAccount.id,
  amount: 90_000,
  createdBy: cashier.id,
});

const expireGateway = await service.expirePendingPayment(db, createdGateway.data.id);
const gatewayStatus = await service.getGatewayPaymentStatus(db, createdGateway.data.id);
const gatewayOrder = await db
  .select()
  .from(orders)
  .where(eq(orders.id, orderForGateway.id));

const expireSepay = await service.expirePendingPayment(db, createdSepay.data.id);
const sepayStatus = await service.getSepayPaymentStatus(db, createdSepay.data.id);
const sepayOrder = await db
  .select()
  .from(orders)
  .where(eq(orders.id, orderForSepay.id));

await db
  .update(payments)
  .set({ status: "confirmed" })
  .where(eq(payments.id, createdGateway.data.id));
const rejectExpireConfirmed = await service.expirePendingPayment(db, createdGateway.data.id);

if (!expireGateway.ok) throw new Error(`expire gateway failed: ${expireGateway.error}`);
if (!gatewayStatus.ok || gatewayStatus.data.status !== "expired") {
  throw new Error(`gateway status is ${gatewayStatus.ok ? gatewayStatus.data.status : "unknown"}`);
}
if (gatewayOrder[0]?.status !== "cancelled") {
  throw new Error("gateway draft order not cancelled");
}

if (!expireSepay.ok) throw new Error(`expire sepay failed: ${expireSepay.error}`);
if (!sepayStatus.ok || sepayStatus.data.status !== "expired") {
  throw new Error(`sepay status is ${sepayStatus.ok ? sepayStatus.data.status : "unknown"}`);
}
if (sepayOrder[0]?.status !== "cancelled") {
  throw new Error("sepay draft order not cancelled");
}

if (!rejectExpireConfirmed.ok || rejectExpireConfirmed.error !== "payments.errors.notConfirmable") {
  throw new Error("non-pending payment should not be expired");
}

console.log("✅ expire service supports pending-only flow");

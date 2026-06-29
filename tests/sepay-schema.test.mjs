/* SePay payment schema smoke test on PGlite.
   Covers bank accounts, payment provider fields, webhook event idempotency, and legacy payment compatibility. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const {
  profiles,
  orders,
  payments,
  paymentBankAccounts,
  paymentWebhookEvents,
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
for (const f of readdirSync(`${PROJ}/drizzle`).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of readFileSync(`${PROJ}/drizzle/${f}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s && !/create extension/i.test(s)) await client.exec(s);
  }
}

ok("schema exports paymentBankAccounts", !!paymentBankAccounts);
ok("schema exports paymentWebhookEvents", !!paymentWebhookEvents);
ok("payments has status/provider fields", "status" in payments && "provider" in payments && "bankAccountId" in payments);

const [cashier] = await db.insert(profiles).values({
  id: "00000000-0000-0000-0000-000000000101",
  fullName: "Cashier SePay",
  role: "cashier",
}).returning();

const [order] = await db.insert(orders).values({
  code: "DH-SEPAY-1",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(250_000),
  total: money(250_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();

const [primaryAccount] = await db.insert(paymentBankAccounts).values({
  provider: "sepay",
  bankCode: "MBBank",
  gateway: "MBBank",
  accountNumber: "123456789",
  accountName: "Luma POS",
  isDefault: true,
  enabled: true,
  webhookEnabled: true,
  webhookSecret: "secret-one",
  createdBy: cashier.id,
}).returning();
const [vaAccount] = await db.insert(paymentBankAccounts).values({
  provider: "sepay",
  bankCode: "ACB",
  gateway: "ACB",
  accountNumber: "987654321",
  subAccount: "VA001",
  accountName: "Luma POS VA",
  enabled: true,
}).returning();

ok("multiple SePay bank accounts can exist", !!primaryAccount.id && !!vaAccount.id && primaryAccount.id !== vaAccount.id);

const [pendingPayment] = await db.insert(payments).values({
  orderId: order.id,
  amount: money(250_000),
  method: "bank_transfer",
  status: "pending",
  provider: "sepay",
  bankAccountId: primaryAccount.id,
  reference: "LUMA-DH-SEPAY-1",
  createdBy: cashier.id,
}).returning();
ok("pending provider payment stores bank account/reference", pendingPayment.status === "pending" && pendingPayment.bankAccountId === primaryAccount.id);

const [legacyPayment] = await db.insert(payments).values({
  orderId: order.id,
  amount: money(10_000),
  method: "cash",
}).returning();
ok("legacy/manual payment defaults to manual_confirmed", legacyPayment.status === "manual_confirmed");

const [event] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-evt-1",
  bankAccountId: primaryAccount.id,
  matchedPaymentId: pendingPayment.id,
  referenceCode: "LUMA-DH-SEPAY-1",
  accountNumber: "123456789",
  gateway: "MBBank",
  transferType: "in",
  transferAmount: money(250_000),
  rawPayload: { id: 1, content: "LUMA-DH-SEPAY-1" },
  status: "received",
  matchStatus: "matched",
}).returning();

ok("webhook event stores match metadata", event.matchedPaymentId === pendingPayment.id && event.matchStatus === "matched");

let duplicateBlocked = false;
try {
  await db.insert(paymentWebhookEvents).values({
    provider: "sepay",
    providerEventId: "sepay-evt-1",
    transferAmount: money(250_000),
    rawPayload: {},
  });
} catch {
  duplicateBlocked = true;
}
ok("provider event id is unique/idempotent", duplicateBlocked);

const [lookup] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.referenceCode, "LUMA-DH-SEPAY-1"));
ok("event is queryable by reference", lookup?.id === event.id);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

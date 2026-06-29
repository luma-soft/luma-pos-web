/* SePay payment service smoke test on PGlite.
   Covers pending payments, webhook confirmation, replay idempotency, and wrong-amount matching. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const service = await import(`${PROJ}/src/lib/payments/service-core.ts`);
const sepay = await import(`${PROJ}/src/lib/payments/sepay.ts`);
const {
  profiles,
  shifts,
  orders,
  customers,
  payments,
  cashTransactions,
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

const [cashier] = await db.insert(profiles).values({
  id: "00000000-0000-0000-0000-000000000201",
  fullName: "Cashier Service",
  role: "cashier",
}).returning();
const [shift] = await db.insert(shifts).values({
  code: "CA-SVC",
  userId: cashier.id,
  openingFloat: money(500_000),
}).returning();
const [account] = await db.insert(paymentBankAccounts).values({
  provider: "sepay",
  bankCode: "MBBank",
  gateway: "MBBank",
  accountNumber: "123123123",
  accountName: "Luma POS",
}).returning();
const [order] = await db.insert(orders).values({
  code: "DH-SVC",
  status: "completed",
  paymentStatus: "unpaid",
  shiftId: shift.id,
  subtotal: money(1_000_000),
  total: money(1_000_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();

console.log("1) Create pending SePay payment");
const pending = await service.createPendingSepayPayment(db, {
  orderId: order.id,
  bankAccountId: account.id,
  amount: 1_000_000,
  reference: "LUMA-DH-SVC",
  createdBy: cashier.id,
});
ok("pending payment created", pending.ok && pending.data.reference === "LUMA-DH-SVC");

let [orderAfterPending] = await db.select().from(orders).where(eq(orders.id, order.id));
let cashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, order.id));
ok("pending does not update order paid amount", Number(orderAfterPending.amountPaid) === 0 && orderAfterPending.paymentStatus === "unpaid");
ok("pending does not write cashbook", cashRows.length === 0);

const [payment] = await db.select().from(payments).where(eq(payments.reference, "LUMA-DH-SVC"));
ok("pending payment has shift/account/provider", payment.status === "pending" && payment.shiftId === shift.id && payment.bankAccountId === account.id && payment.provider === "sepay");

console.log("2) Match webhook and confirm once");
const [event] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-1",
  referenceCode: "LUMA-DH-SVC",
  accountNumber: account.accountNumber,
  gateway: account.gateway,
  transferType: "in",
  transferAmount: money(1_000_000),
  transactionDate: new Date("2026-06-29T10:00:00Z"),
  rawPayload: { id: "sepay-svc-evt-1", content: "LUMA-DH-SVC" },
}).returning();

const match = await service.matchSepayWebhookEvent(db, event.id);
ok("webhook matched", match.ok && match.data.matched === true);

const [confirmedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id));
[orderAfterPending] = await db.select().from(orders).where(eq(orders.id, order.id));
cashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, order.id));
ok("payment confirmed with provider transaction", confirmedPayment.status === "confirmed" && confirmedPayment.providerTransactionId === "sepay-svc-evt-1");
ok("order paid after webhook", Number(orderAfterPending.amountPaid) === 1_000_000 && orderAfterPending.paymentStatus === "paid");
ok("cashbook posted once", cashRows.length === 1 && cashRows[0].fund === "bank" && Number(cashRows[0].amount) === 1_000_000);

const replay = await service.matchSepayWebhookEvent(db, event.id);
cashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, order.id));
ok("webhook replay is idempotent", replay.ok && replay.data.matched === true && cashRows.length === 1);

const normalized = sepay.normalizeSepayWebhookPayload({
  id: "sepay-svc-evt-normalized",
  account_number: account.accountNumber,
  amount: "1000000",
  content: "Thanh toan LUMA-DH-SVC",
});
ok("webhook payload normalization extracts reference", normalized?.referenceCode === "LUMA-DH-SVC" && normalized.transferAmount === 1_000_000);

const recorded = await service.recordSepayWebhookEvent(db, normalized);
const recordedAgain = await service.recordSepayWebhookEvent(db, normalized);
ok("webhook event recording is idempotent", recorded.ok && recordedAgain.ok && recorded.data.eventId === recordedAgain.data.eventId && recordedAgain.data.duplicate === true);

const qrUrl = sepay.buildSepayVietQrImageUrl({
  bankCode: account.bankCode,
  accountNumber: account.accountNumber,
  amount: 1_000_000,
  reference: "LUMA-DH-SVC",
});
ok("VietQR image url includes account amount and reference", qrUrl.includes("qr.sepay.vn/img?") && qrUrl.includes("amount=1000000") && qrUrl.includes("des=LUMA-DH-SVC"));

console.log("3) Wrong amount stays unmatched and does not post");
const [wrongOrder] = await db.insert(orders).values({
  code: "DH-WRONG",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(500_000),
  total: money(500_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const wrongPending = await service.createPendingSepayPayment(db, {
  orderId: wrongOrder.id,
  bankAccountId: account.id,
  amount: 500_000,
  reference: "LUMA-DH-WRONG",
  createdBy: cashier.id,
});
ok("wrong case pending created", wrongPending.ok);
const [wrongEvent] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-wrong",
  referenceCode: "LUMA-DH-WRONG",
  accountNumber: account.accountNumber,
  transferType: "in",
  transferAmount: money(499_000),
  rawPayload: { id: "sepay-svc-evt-wrong" },
}).returning();
const wrongMatch = await service.matchSepayWebhookEvent(db, wrongEvent.id);
const [wrongEventAfter] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.id, wrongEvent.id));
const wrongCashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, wrongOrder.id));
ok("wrong amount remains unmatched", wrongMatch.ok && wrongMatch.data.matched === false && wrongEventAfter.matchStatus === "wrong_amount");
ok("wrong amount does not post cashbook", wrongCashRows.length === 0);

console.log("4) Provider confirmation reduces customer debt");
const [customer] = await db.insert(customers).values({
  name: "Debt Customer",
  currentDebt: money(200_000),
}).returning();
const [debtOrder] = await db.insert(orders).values({
  code: "DH-DEBT",
  status: "completed",
  paymentStatus: "unpaid",
  customerId: customer.id,
  subtotal: money(200_000),
  total: money(200_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const debtPending = await service.createPendingSepayPayment(db, {
  orderId: debtOrder.id,
  bankAccountId: account.id,
  amount: 200_000,
  reference: "LUMA-DH-DEBT",
  createdBy: cashier.id,
});
const [debtEvent] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-debt",
  referenceCode: "LUMA-DH-DEBT",
  accountNumber: account.accountNumber,
  transferType: "in",
  transferAmount: money(200_000),
  rawPayload: { id: "sepay-svc-evt-debt" },
}).returning();
const debtMatch = await service.matchSepayWebhookEvent(db, debtEvent.id);
const [customerAfterPayment] = await db.select().from(customers).where(eq(customers.id, customer.id));
ok("customer debt reduced after provider confirmation", debtPending.ok && debtMatch.ok && Number(customerAfterPayment.currentDebt) === 0);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

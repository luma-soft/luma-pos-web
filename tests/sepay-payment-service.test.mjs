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

const pendingRetry = await service.createPendingSepayPayment(db, {
  orderId: order.id,
  bankAccountId: account.id,
  amount: 1_000_000,
  reference: "LUMA-DH-SVC",
  createdBy: cashier.id,
});
ok("pending payment retry is idempotent", pendingRetry.ok && pendingRetry.data.id === pending.data.id);

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

console.log("5) Stale pending payment expires authoritatively");
const [timeoutOrder] = await db.insert(orders).values({
  code: "DH-TIMEOUT",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(100_000),
  total: money(100_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const timeoutPending = await service.createPendingSepayPayment(db, {
  orderId: timeoutOrder.id,
  bankAccountId: account.id,
  amount: 100_000,
  reference: "LUMA-DH-TIMEOUT",
  createdBy: cashier.id,
});
await db.update(payments).set({
  createdAt: new Date(Date.now() - service.SEPAY_PAYMENT_TIMEOUT_MS - 1_000),
}).where(eq(payments.id, timeoutPending.data.id));
const timeoutStatus = await service.getSepayPaymentStatus(db, timeoutPending.data.id);
ok("stale pending becomes expired", timeoutStatus.ok && timeoutStatus.data.status === "expired");

console.log("6) Manager reconciliation requires exact provider evidence");
const [reconcileOrder] = await db.insert(orders).values({
  code: "DH-RECONCILE",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(320_000),
  total: money(320_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const reconcilePending = await service.createPendingSepayPayment(db, {
  orderId: reconcileOrder.id,
  bankAccountId: account.id,
  amount: 320_000,
  reference: "LUMA-DH-RECONCILE",
  createdBy: cashier.id,
});
const [unmatchedEvidence] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-reconcile",
  accountNumber: account.accountNumber,
  bankAccountId: account.id,
  transferType: "in",
  transferAmount: money(320_000),
  matchStatus: "unmatched",
  matchReason: "missing_reference",
  rawPayload: { id: "sepay-svc-evt-reconcile" },
}).returning();
const reconcile = await service.reconcilePaymentWithEvent(db, {
  paymentId: reconcilePending.data.id,
  eventId: unmatchedEvidence.id,
  actorId: cashier.id,
});
const [reconciledPayment] = await db.select().from(payments).where(eq(payments.id, reconcilePending.data.id));
const [reconciledEvent] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.id, unmatchedEvidence.id));
const [reconciledOrder] = await db.select().from(orders).where(eq(orders.id, reconcileOrder.id));
const reconciledCashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, reconcileOrder.id));
ok("exact bank event reconciles payment", reconcile.ok && reconciledPayment.status === "reconciled");
ok("reconciliation links immutable provider evidence", reconciledEvent.matchStatus === "matched" && reconciledEvent.matchedPaymentId === reconciledPayment.id && reconciledPayment.rawMatchedEventId === reconciledEvent.id);
ok("reconciliation posts order and cashbook once", Number(reconciledOrder.amountPaid) === 320_000 && reconciledCashRows.length === 1);

const [unsafeOrder] = await db.insert(orders).values({
  code: "DH-RECONCILE-UNSAFE",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(100_000),
  total: money(100_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const unsafePending = await service.createPendingSepayPayment(db, {
  orderId: unsafeOrder.id,
  bankAccountId: account.id,
  amount: 100_000,
  reference: "LUMA-DH-RECONCILE-UNSAFE",
  createdBy: cashier.id,
});
const [wrongEvidence] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-reconcile-wrong",
  accountNumber: account.accountNumber,
  bankAccountId: account.id,
  transferType: "in",
  transferAmount: money(99_000),
  matchStatus: "wrong_amount",
  rawPayload: { id: "sepay-svc-evt-reconcile-wrong" },
}).returning();
const unsafeReconcile = await service.reconcilePaymentWithEvent(db, {
  paymentId: unsafePending.data.id,
  eventId: wrongEvidence.id,
  actorId: cashier.id,
});
const [unsafePaymentAfter] = await db.select().from(payments).where(eq(payments.id, unsafePending.data.id));
ok("amount mismatch cannot be manually confirmed", !unsafeReconcile.ok && unsafeReconcile.error === "payments.errors.amountMismatch" && unsafePaymentAfter.status === "pending");

const queue = await service.getPaymentReconciliation(db, {
  status: "actionable",
  limit: 100,
});
ok("reconciliation queue exposes actionable payments", queue.ok && queue.data.payments.some((row) => row.id === unsafePending.data.id && row.orderCode === "DH-RECONCILE-UNSAFE"));
ok("reconciliation queue exposes unmatched evidence without raw payload", queue.ok && queue.data.events.some((row) => row.id === wrongEvidence.id && !("rawPayload" in row) && !("content" in row)));
ok("reconciliation summary is server-derived", queue.ok && queue.data.summary.pending >= 1 && queue.data.summary.wrongAmountEvents >= 1);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

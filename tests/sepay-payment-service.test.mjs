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
  notificationEvents,
  notificationRecipients,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const money = (n) => n.toFixed(2);

function withConcurrentPaymentReads(database, paymentTable, reference) {
  let arrivals = 0;
  let releasePair = () => {};
  let pairGate = new Promise((resolve) => {
    releasePair = resolve;
  });

  async function waitForPair(rows) {
    if (
      arrivals >= 4
      || rows[0]?.reference !== reference
      || rows[0]?.status !== "pending"
    ) {
      return rows;
    }
    const gate = pairGate;
    arrivals += 1;
    if (arrivals % 2 === 0) {
      releasePair();
      pairGate = new Promise((resolve) => {
        releasePair = resolve;
      });
    }
    await gate;
    return rows;
  }

  function wrapQuery(builder, fromPayments = false) {
    return new Proxy(builder, {
      get(target, property) {
        if (property === "from") {
          return (table) => wrapQuery(target.from(table), table === paymentTable);
        }
        if (property === "then") {
          return (resolve, reject) => target.then(
            (rows) => fromPayments
              ? waitForPair(rows).then(resolve, reject)
              : resolve(rows),
            reject,
          );
        }
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args) => wrapQuery(value.apply(target, args), fromPayments);
      },
    });
  }

  const concurrentTx = new Proxy(database, {
    get(target, property) {
      if (property === "select") {
        return (...args) => wrapQuery(target.select(...args));
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(database, {
    get(target, property) {
      if (property === "transaction") {
        return (callback) => callback(concurrentTx);
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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
const [owner, manager] = await db.insert(profiles).values([
  {
    id: "00000000-0000-0000-0000-000000000202",
    fullName: "Owner Service",
    role: "owner",
  },
  {
    id: "00000000-0000-0000-0000-000000000203",
    fullName: "Manager Service",
    role: "manager",
  },
]).returning();
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
  status: "verified",
  rawPayload: { id: "sepay-svc-evt-1", content: "LUMA-DH-SVC" },
}).returning();

const match = await service.matchSepayWebhookEvent(db, event.id);
ok("webhook matched", match.ok && match.data.matched === true);

const [confirmedPayment] = await db.select().from(payments).where(eq(payments.id, payment.id));
[orderAfterPending] = await db.select().from(orders).where(eq(orders.id, order.id));
cashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, order.id));
let qrEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.category, "qrPaymentConfirmed"));
const qrRecipients = qrEvents[0]
  ? await db.select().from(notificationRecipients)
    .where(eq(notificationRecipients.eventId, qrEvents[0].id))
  : [];
const debtEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.category, "debtChanged"));
const invoiceEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.category, "invoiceCreated"));
ok("payment confirmed with provider transaction", confirmedPayment.status === "confirmed" && confirmedPayment.providerTransactionId === "sepay-svc-evt-1");
ok("order paid after webhook", Number(orderAfterPending.amountPaid) === 1_000_000 && orderAfterPending.paymentStatus === "paid");
ok("cashbook posted once", cashRows.length === 1 && cashRows[0].fund === "bank" && Number(cashRows[0].amount) === 1_000_000);
ok(
  "QR confirmation emits once and returns its newly created event",
  qrEvents.length === 1
    && match.ok
    && match.data.notificationCreated === true
    && match.data.notificationEventId === qrEvents[0].id,
);
ok(
  "QR event points to order and protects debt metadata",
  qrEvents[0]?.entityId === order.id
    && qrEvents[0]?.target === "invoices"
    && qrEvents[0]?.priority === "high"
    && qrEvents[0]?.quietHoursPolicy === "bypass"
    && qrEvents[0]?.metadata?.paymentId === payment.id
    && qrEvents[0]?.metadata?.provider === "sepay"
    && qrEvents[0]?.metadata?.debtDelta === "-1000000.00",
);
ok(
  "QR confirmation routes to creator directly plus owner and manager",
  JSON.stringify(qrRecipients.map((recipient) => recipient.userId).sort())
    === JSON.stringify([cashier.id, manager.id, owner.id].sort())
    && qrRecipients.find((recipient) => recipient.userId === cashier.id)?.reason === "direct",
);
ok(
  "QR event is the only primary event and absorbs debt change",
  debtEvents.length === 0 && invoiceEvents.length === 0,
);

const replay = await service.matchSepayWebhookEvent(db, event.id);
cashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, order.id));
qrEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.category, "qrPaymentConfirmed"));
ok(
  "webhook replay is idempotent",
  replay.ok
    && replay.data.matched === true
    && !replay.data.notificationEventId
    && cashRows.length === 1
    && qrEvents.length === 1,
);

console.log("2a) Concurrent provider events fence one payment transition");
const [concurrentOrder] = await db.insert(orders).values({
  code: "DH-CONCURRENT",
  status: "completed",
  paymentStatus: "unpaid",
  shiftId: shift.id,
  subtotal: money(180_000),
  total: money(180_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const concurrentPending = await service.createPendingSepayPayment(db, {
  orderId: concurrentOrder.id,
  bankAccountId: account.id,
  amount: 180_000,
  reference: "LUMA-DH-CONCURRENT",
  createdBy: cashier.id,
});
const concurrentEvents = await db.insert(paymentWebhookEvents).values([
  {
    provider: "sepay",
    providerEventId: "sepay-svc-concurrent-a",
    referenceCode: "LUMA-DH-CONCURRENT",
    accountNumber: account.accountNumber,
    gateway: account.gateway,
    transferType: "in",
    transferAmount: money(180_000),
    status: "verified",
    rawPayload: { id: "sepay-svc-concurrent-a" },
  },
  {
    provider: "sepay",
    providerEventId: "sepay-svc-concurrent-b",
    referenceCode: "LUMA-DH-CONCURRENT",
    accountNumber: account.accountNumber,
    gateway: account.gateway,
    transferType: "in",
    transferAmount: money(180_000),
    status: "verified",
    rawPayload: { id: "sepay-svc-concurrent-b" },
  },
]).returning();
const concurrentDb = withConcurrentPaymentReads(
  db,
  payments,
  "LUMA-DH-CONCURRENT",
);
const concurrentResults = await Promise.all(
  concurrentEvents.map((row) => service.matchSepayWebhookEvent(concurrentDb, row.id)),
);
const [concurrentPaymentAfter] = await db.select().from(payments)
  .where(eq(payments.id, concurrentPending.data.id));
const [concurrentOrderAfter] = await db.select().from(orders)
  .where(eq(orders.id, concurrentOrder.id));
const concurrentCash = await db.select().from(cashTransactions)
  .where(eq(cashTransactions.refId, concurrentOrder.id));
const concurrentNotifications = await db.select().from(notificationEvents)
  .where(eq(
    notificationEvents.eventKey,
    `qr-payment-confirmed:${concurrentPending.data.id}`,
  ));
ok(
  "two concurrent events produce exactly one business effect and notification",
  concurrentResults.every((result) => result.ok)
    && concurrentPaymentAfter.status === "confirmed"
    && Number(concurrentOrderAfter.amountPaid) === 180_000
    && concurrentCash.length === 1
    && concurrentNotifications.length === 1,
  JSON.stringify({
    results: concurrentResults,
    amountPaid: concurrentOrderAfter.amountPaid,
    cash: concurrentCash.length,
    notifications: concurrentNotifications.length,
  }),
);

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
  status: "verified",
  rawPayload: { id: "sepay-svc-evt-wrong" },
}).returning();
const wrongMatch = await service.matchSepayWebhookEvent(db, wrongEvent.id);
const wrongReplay = await service.matchSepayWebhookEvent(db, wrongEvent.id);
const [wrongEventAfter] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.id, wrongEvent.id));
const wrongCashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, wrongOrder.id));
const wrongExceptionEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.eventKey, `qr-payment-exception:${wrongEvent.id}:amount_mismatch`));
ok("wrong amount remains unmatched", wrongMatch.ok && wrongMatch.data.matched === false && wrongEventAfter.matchStatus === "wrong_amount");
ok("wrong amount does not post cashbook", wrongCashRows.length === 0);
ok(
  "verified amount mismatch emits one replay-safe QR exception",
  wrongReplay.ok
    && wrongExceptionEvents.length === 1
    && wrongMatch.data.notificationCreated === true
    && wrongMatch.data.notificationEventId === wrongExceptionEvents[0].id
    && wrongReplay.data.notificationCreated === false
    && wrongExceptionEvents[0].category === "qrPaymentException"
    && wrongExceptionEvents[0].entityId === wrongEvent.id
    && wrongExceptionEvents[0].target === "paymentReconciliation"
    && wrongExceptionEvents[0].priority === "high"
    && wrongExceptionEvents[0].quietHoursPolicy === "bypass"
    && JSON.stringify(wrongExceptionEvents[0].metadata) === JSON.stringify({ reason: "amount_mismatch" }),
);

console.log("3a) Verified reconciliation exceptions emit once per reason");
const recordedMissingReference = await service.recordSepayWebhookEvent(db, {
  providerEventId: "sepay-svc-evt-missing-reference",
  referenceCode: null,
  accountNumber: account.accountNumber,
  subAccount: null,
  gateway: account.gateway,
  transferType: "in",
  transferAmount: 90_000,
  transactionDate: null,
  content: null,
  rawPayload: { privateBankPayload: "must-not-reach-notifications" },
}, { verified: true });
const [missingReferenceEvent] = await db.select().from(paymentWebhookEvents)
  .where(eq(paymentWebhookEvents.id, recordedMissingReference.data.eventId));
const missingReferenceMatch = await service.matchSepayWebhookEvent(db, missingReferenceEvent.id);
const missingReferenceReplay = await service.matchSepayWebhookEvent(db, missingReferenceEvent.id);
const missingReferenceExceptions = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.eventKey, `qr-payment-exception:${missingReferenceEvent.id}:missing_reference`));
const missingReferenceRecipients = missingReferenceExceptions[0]
  ? await db.select().from(notificationRecipients)
    .where(eq(notificationRecipients.eventId, missingReferenceExceptions[0].id))
  : [];
ok(
  "verified missing reference emits one replay-safe QR exception",
  missingReferenceMatch.ok
    && missingReferenceMatch.data.reason === "missing_reference"
    && missingReferenceReplay.ok
    && missingReferenceExceptions.length === 1
    && missingReferenceMatch.data.notificationCreated === true
    && missingReferenceMatch.data.notificationEventId === missingReferenceExceptions[0].id
    && missingReferenceReplay.data.notificationCreated === false
    && missingReferenceExceptions[0].category === "qrPaymentException"
    && missingReferenceExceptions[0].entityId === missingReferenceEvent.id
    && JSON.stringify(missingReferenceRecipients.map((recipient) => recipient.userId).sort())
      === JSON.stringify([manager.id, owner.id].sort())
    && JSON.stringify(missingReferenceExceptions[0].metadata) === JSON.stringify({ reason: "missing_reference" }),
);

const [missingPaymentEvent] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-missing-payment",
  referenceCode: "LUMA-NOT-A-PENDING-PAYMENT",
  accountNumber: account.accountNumber,
  transferType: "in",
  transferAmount: money(90_000),
  status: "verified",
  rawPayload: { privateBankPayload: "must-not-reach-notifications" },
}).returning();
const missingPaymentMatch = await service.matchSepayWebhookEvent(db, missingPaymentEvent.id);
const missingPaymentReplay = await service.matchSepayWebhookEvent(db, missingPaymentEvent.id);
const missingPaymentExceptions = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.eventKey, `qr-payment-exception:${missingPaymentEvent.id}:pending_payment_not_found`));
ok(
  "verified missing pending payment emits one replay-safe QR exception",
  missingPaymentMatch.ok
    && missingPaymentMatch.data.reason === "pending_payment_not_found"
    && missingPaymentReplay.ok
    && missingPaymentExceptions.length === 1
    && missingPaymentMatch.data.notificationCreated === true
    && missingPaymentMatch.data.notificationEventId === missingPaymentExceptions[0].id
    && missingPaymentReplay.data.notificationCreated === false
    && missingPaymentExceptions[0].category === "qrPaymentException"
    && missingPaymentExceptions[0].entityId === missingPaymentEvent.id
    && JSON.stringify(missingPaymentExceptions[0].metadata) === JSON.stringify({ reason: "pending_payment_not_found" }),
);

const recordedUnverified = await service.recordSepayWebhookEvent(db, {
  providerEventId: "sepay-svc-evt-unverified",
  referenceCode: null,
  accountNumber: account.accountNumber,
  subAccount: null,
  gateway: account.gateway,
  transferType: "in",
  transferAmount: 90_000,
  transactionDate: null,
  content: null,
  rawPayload: { privateBankPayload: "must-not-reach-notifications" },
});
const [unverifiedEvent] = await db.select().from(paymentWebhookEvents)
  .where(eq(paymentWebhookEvents.id, recordedUnverified.data.eventId));
const unverifiedMatch = await service.matchSepayWebhookEvent(db, unverifiedEvent.id);
const unverifiedExceptions = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.eventKey, `qr-payment-exception:${unverifiedEvent.id}:missing_reference`));
ok(
  "unverified incoming event never emits a QR exception",
  unverifiedMatch.ok
    && unverifiedMatch.data.reason === "event_not_verified"
    && unverifiedExceptions.length === 0,
);

console.log("3b) Unverified exact evidence cannot confirm or reconcile");
const [unverifiedExactOrder] = await db.insert(orders).values({
  code: "DH-UNVERIFIED-EXACT",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(140_000),
  total: money(140_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const unverifiedExactPending = await service.createPendingSepayPayment(db, {
  orderId: unverifiedExactOrder.id,
  bankAccountId: account.id,
  amount: 140_000,
  reference: "LUMA-DH-UNVERIFIED-EXACT",
  createdBy: cashier.id,
});
const [unverifiedExactEvent] = await db.insert(paymentWebhookEvents).values({
  provider: "sepay",
  providerEventId: "sepay-svc-evt-unverified-exact",
  referenceCode: "LUMA-DH-UNVERIFIED-EXACT",
  accountNumber: account.accountNumber,
  bankAccountId: account.id,
  transferType: "in",
  transferAmount: money(140_000),
  status: "received",
  rawPayload: { privateBankPayload: "must-not-confirm" },
}).returning();
const unverifiedExactMatch = await service.matchSepayWebhookEvent(db, unverifiedExactEvent.id);
const unverifiedExactReconcile = await service.reconcilePaymentWithEvent(db, {
  paymentId: unverifiedExactPending.data.id,
  eventId: unverifiedExactEvent.id,
  actorId: cashier.id,
});
const [unverifiedExactPaymentAfter] = await db.select().from(payments)
  .where(eq(payments.id, unverifiedExactPending.data.id));
const [unverifiedExactEventAfter] = await db.select().from(paymentWebhookEvents)
  .where(eq(paymentWebhookEvents.id, unverifiedExactEvent.id));
const [unverifiedExactOrderAfter] = await db.select().from(orders)
  .where(eq(orders.id, unverifiedExactOrder.id));
const unverifiedExactCash = await db.select().from(cashTransactions)
  .where(eq(cashTransactions.refId, unverifiedExactOrder.id));
const unverifiedExactQrEvents = await db.select().from(notificationEvents)
  .where(eq(notificationEvents.eventKey, `qr-payment-confirmed:${unverifiedExactPending.data.id}`));
ok(
  "unverified exact event remains unmatched and cannot settle payment",
  unverifiedExactMatch.ok
    && unverifiedExactMatch.data.matched === false
    && unverifiedExactMatch.data.reason === "event_not_verified"
    && !unverifiedExactReconcile.ok
    && unverifiedExactReconcile.error === "payments.errors.eventNotVerified"
    && unverifiedExactEventAfter.matchStatus === "unmatched"
    && unverifiedExactEventAfter.matchReason === "event_not_verified"
    && unverifiedExactPaymentAfter.status === "pending"
    && Number(unverifiedExactOrderAfter.amountPaid) === 0
    && unverifiedExactCash.length === 0
    && unverifiedExactQrEvents.length === 0,
);

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
  status: "verified",
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
  status: "verified",
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
  status: "verified",
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

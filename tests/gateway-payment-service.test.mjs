/* Gateway payment state-machine smoke test on PGlite.
   Provider redirects never settle money; only exact, signed-normalized callbacks do. */
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
  orders,
  orderItems,
  products,
  warehouses,
  stockLevels,
  payments,
  cashTransactions,
  paymentWebhookEvents,
} = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
let pass = 0, fail = 0;
const ok = (name, condition) => {
  if (condition) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
};
const money = (value) => value.toFixed(2);

for (const file of readdirSync(`${PROJ}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${PROJ}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const [cashier] = await db.insert(profiles).values({
  id: "00000000-0000-0000-0000-000000000301",
  fullName: "Gateway Cashier",
  role: "cashier",
}).returning();
const [shift] = await db.insert(shifts).values({
  code: "CA-GATEWAY",
  userId: cashier.id,
  openingFloat: money(0),
}).returning();
const [warehouse] = await db.insert(warehouses).values({
  name: "Gateway Warehouse",
}).returning();
const [product] = await db.insert(products).values({
  sku: "GW-001",
  name: "Gateway Product",
  retailPrice: money(450_000),
}).returning();
await db.insert(stockLevels).values({
  productId: product.id,
  warehouseId: warehouse.id,
  quantity: money(2),
});
const [order] = await db.insert(orders).values({
  code: "DH-GATEWAY",
  status: "draft",
  paymentStatus: "unpaid",
  shiftId: shift.id,
  warehouseId: warehouse.id,
  subtotal: money(450_000),
  total: money(450_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
await db.insert(orderItems).values({
  orderId: order.id,
  productId: product.id,
  productName: product.name,
  unitName: "cái",
  unitMultiplier: money(1),
  quantity: money(1),
  unitPrice: money(450_000),
  total: money(450_000),
});

console.log("1) Durable gateway intent is idempotent and never pre-confirms");
const pending = await service.createPendingGatewayPayment(db, {
  orderId: order.id,
  provider: "momo",
  amount: 450_000,
  reference: "LUMA-MOMO-DH-GATEWAY",
  clientRequestId: "client-request-gateway-001",
  createdBy: cashier.id,
});
const retry = await service.createPendingGatewayPayment(db, {
  orderId: order.id,
  provider: "momo",
  amount: 450_000,
  reference: "LUMA-MOMO-DH-GATEWAY",
  clientRequestId: "client-request-gateway-001",
  createdBy: cashier.id,
});
ok("pending intent is idempotent", pending.ok && retry.ok && retry.data.id === pending.data.id);
await service.attachGatewayIntent(db, {
  paymentId: pending.data.id,
  checkoutUrl: "https://test-payment.momo.vn/pay/signed",
  deepLink: "momo://pay/signed",
  qrPayload: "000201010212",
  expiresAt: new Date(Date.now() + 15 * 60_000),
  providerStatus: "created",
});
const intentStatus = await service.getGatewayPaymentStatus(db, pending.data.id);
const [orderBeforeCallback] = await db.select().from(orders).where(eq(orders.id, order.id));
ok("intent exposes provider presentation", intentStatus.ok && intentStatus.data.checkoutUrl.includes("test-payment.momo.vn") && intentStatus.data.status === "pending");
ok("redirect intent does not post money", Number(orderBeforeCallback.amountPaid) === 0);

console.log("2) Exact provider/reference/amount callback confirms once");
const wrong = await service.recordGatewayCallbackAndMatch(db, {
  provider: "momo",
  providerEventId: "momo-event-wrong",
  reference: "LUMA-MOMO-DH-GATEWAY",
  amount: 449_000,
  providerTransactionId: "momo-tx-wrong",
  successful: true,
  occurredAt: new Date("2026-07-19T04:00:00Z"),
  rawPayload: { signed: true, amount: 449000 },
});
const [paymentAfterWrong] = await db.select().from(payments).where(eq(payments.id, pending.data.id));
ok("wrong amount remains unconfirmed", wrong.ok && wrong.data.matched === false && wrong.data.reason === "amount_mismatch" && paymentAfterWrong.status === "pending");

const confirmed = await service.recordGatewayCallbackAndMatch(db, {
  provider: "momo",
  providerEventId: "momo-event-success",
  reference: "LUMA-MOMO-DH-GATEWAY",
  amount: 450_000,
  providerTransactionId: "momo-tx-success",
  successful: true,
  occurredAt: new Date("2026-07-19T04:01:00Z"),
  rawPayload: { signed: true, amount: 450000 },
});
const replay = await service.recordGatewayCallbackAndMatch(db, {
  provider: "momo",
  providerEventId: "momo-event-success",
  reference: "LUMA-MOMO-DH-GATEWAY",
  amount: 450_000,
  providerTransactionId: "momo-tx-success",
  successful: true,
  occurredAt: new Date("2026-07-19T04:01:00Z"),
  rawPayload: { signed: true, amount: 450000 },
});
const [paymentAfterCallback] = await db.select().from(payments).where(eq(payments.id, pending.data.id));
const [orderAfterCallback] = await db.select().from(orders).where(eq(orders.id, order.id));
const cashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, order.id));
ok("valid callback confirms payment", confirmed.ok && confirmed.data.matched && paymentAfterCallback.status === "confirmed" && paymentAfterCallback.providerTransactionId === "momo-tx-success");
const [stockAfterCallback] = await db.select().from(stockLevels).where(eq(stockLevels.productId, product.id));
ok("callback posts order and cashbook exactly once", Number(orderAfterCallback.amountPaid) === 450_000 && orderAfterCallback.status === "completed" && cashRows.length === 1);
ok("confirmed draft consumes stock exactly once", Number(stockAfterCallback.quantity) === 1);
ok("callback replay is idempotent", replay.ok && replay.data.duplicate === true && cashRows.length === 1);

console.log("3) Non-success callback is evidence only");
const [failedOrder] = await db.insert(orders).values({
  code: "DH-GATEWAY-FAILED",
  status: "draft",
  paymentStatus: "unpaid",
  subtotal: money(90_000),
  total: money(90_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const failedPending = await service.createPendingGatewayPayment(db, {
  orderId: failedOrder.id,
  provider: "zalopay",
  amount: 90_000,
  reference: "260719_LUMAFAILED",
  clientRequestId: "client-request-gateway-002",
  createdBy: cashier.id,
});
const failedEvent = await service.recordGatewayCallbackAndMatch(db, {
  provider: "zalopay",
  providerEventId: "zalopay-event-failed",
  reference: "260719_LUMAFAILED",
  amount: 90_000,
  providerTransactionId: null,
  successful: false,
  rawPayload: { signed: true, return_code: 2 },
});
const [failedPaymentAfter] = await db.select().from(payments).where(eq(payments.id, failedPending.data.id));
const [storedFailedEvent] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.providerEventId, "zalopay-event-failed"));
ok("non-success callback does not settle", failedEvent.ok && !failedEvent.data.matched && failedPaymentAfter.status === "pending");
ok("non-success callback remains auditable", storedFailedEvent.matchStatus === "ignored" && storedFailedEvent.matchReason === "provider_not_successful");
const markedFailed = await service.failGatewayPayment(db, {
  paymentId: failedPending.data.id,
  providerStatus: "2",
  providerError: "provider_rejected",
});
const failedStatus = await service.getGatewayPaymentStatus(db, failedPending.data.id);
const [failedOrderAfter] = await db.select().from(orders).where(eq(orders.id, failedOrder.id));
ok("explicit create rejection becomes failed", markedFailed.ok && failedStatus.ok && failedStatus.data.status === "failed" && failedStatus.data.providerStatus === "2");
ok("failed provider setup cancels an un-settled draft", failedOrderAfter.status === "cancelled");

console.log("4) Manager recovery accepts only verified gateway evidence");
const [reconcileOrder] = await db.insert(orders).values({
  code: "DH-GATEWAY-RECONCILE",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(75_000),
  total: money(75_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const reconcilePending = await service.createPendingGatewayPayment(db, {
  orderId: reconcileOrder.id,
  provider: "vnpay",
  amount: 75_000,
  reference: "LUMAVRECONCILE",
  clientRequestId: "client-request-gateway-003",
  createdBy: cashier.id,
});
await service.recordGatewayCallbackAndMatch(db, {
  provider: "vnpay",
  providerEventId: "vnpay-event-missing-reference",
  reference: null,
  amount: 75_000,
  providerTransactionId: "vnpay-tx-reconcile",
  successful: true,
  rawPayload: { verified: true, vnp_Amount: "7500000" },
});
const [verifiedEvidence] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.providerEventId, "vnpay-event-missing-reference"));
const reconciled = await service.reconcilePaymentWithEvent(db, {
  paymentId: reconcilePending.data.id,
  eventId: verifiedEvidence.id,
  actorId: cashier.id,
});
const [reconciledPayment] = await db.select().from(payments).where(eq(payments.id, reconcilePending.data.id));
ok("verified exact gateway event can be manager-reconciled", reconciled.ok && reconciledPayment.status === "reconciled");

console.log("5) Provider inquiry is throttled and settles exact evidence once");
const [inquiryOrder] = await db.insert(orders).values({
  code: "DH-GATEWAY-INQUIRY",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(125_000),
  total: money(125_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const inquiryPending = await service.createPendingGatewayPayment(db, {
  orderId: inquiryOrder.id,
  provider: "zalopay",
  amount: 125_000,
  reference: "260719_LUMAINQUIRY",
  clientRequestId: "client-request-gateway-004",
  createdBy: cashier.id,
});
let inquiryCalls = 0;
const firstInquiryAt = new Date("2026-07-19T05:00:00Z");
const pendingInquiry = await service.refreshGatewayPaymentFromInquiry(
  db,
  inquiryPending.data.id,
  async (payment) => {
    inquiryCalls += 1;
    ok("inquiry receives server-owned payment identity", payment.reference === "260719_LUMAINQUIRY" && payment.amount === 125_000 && payment.orderCode === "DH-GATEWAY-INQUIRY");
    return {
      ok: true,
      state: "pending",
      reference: payment.reference,
      amount: payment.amount,
      providerTransactionId: null,
      providerStatus: "3",
      occurredAt: null,
      rawPayload: { return_code: 3 },
    };
  },
  { now: firstInquiryAt, minIntervalMs: 10_000 },
);
const throttledInquiry = await service.refreshGatewayPaymentFromInquiry(
  db,
  inquiryPending.data.id,
  async () => {
    inquiryCalls += 1;
    throw new Error("should not query inside throttle window");
  },
  { now: new Date(firstInquiryAt.getTime() + 1_000), minIntervalMs: 10_000 },
);
ok("pending inquiry is recorded without settlement", pendingInquiry.ok && pendingInquiry.data.queried && pendingInquiry.data.status === "pending");
ok("inquiry is throttled per payment", throttledInquiry.ok && !throttledInquiry.data.queried && inquiryCalls === 1);

const confirmedInquiry = await service.refreshGatewayPaymentFromInquiry(
  db,
  inquiryPending.data.id,
  async (payment) => ({
    ok: true,
    state: "confirmed",
    reference: payment.reference,
    amount: payment.amount,
    providerTransactionId: "zalopay-query-tx-1",
    providerStatus: "1",
    occurredAt: new Date("2026-07-19T05:00:11Z"),
    rawPayload: { return_code: 1, amount: 125000 },
  }),
  { now: new Date(firstInquiryAt.getTime() + 11_000), minIntervalMs: 10_000 },
);
const [inquiryPaymentAfter] = await db.select().from(payments).where(eq(payments.id, inquiryPending.data.id));
const [inquiryOrderAfter] = await db.select().from(orders).where(eq(orders.id, inquiryOrder.id));
const inquiryCashRows = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, inquiryOrder.id));
ok("exact inquiry confirmation settles once", confirmedInquiry.ok && confirmedInquiry.data.status === "confirmed" && inquiryPaymentAfter.providerTransactionId === "zalopay-query-tx-1" && Number(inquiryOrderAfter.amountPaid) === 125_000 && inquiryCashRows.length === 1);
ok("inquiry metadata is durable", inquiryPaymentAfter.providerQueryAttempts === 2 && inquiryPaymentAfter.lastProviderCheckedAt?.getTime() === firstInquiryAt.getTime() + 11_000);

console.log("6) Provider inquiry mismatch never settles money");
const [mismatchOrder] = await db.insert(orders).values({
  code: "DH-GATEWAY-INQUIRY-MISMATCH",
  status: "completed",
  paymentStatus: "unpaid",
  subtotal: money(80_000),
  total: money(80_000),
  amountPaid: money(0),
  createdBy: cashier.id,
}).returning();
const mismatchPending = await service.createPendingGatewayPayment(db, {
  orderId: mismatchOrder.id,
  provider: "momo",
  amount: 80_000,
  reference: "LUMA-M-INQUIRY-MISMATCH",
  clientRequestId: "client-request-gateway-005",
  createdBy: cashier.id,
});
const mismatchInquiry = await service.refreshGatewayPaymentFromInquiry(
  db,
  mismatchPending.data.id,
  async (payment) => ({
    ok: true,
    state: "confirmed",
    reference: payment.reference,
    amount: payment.amount - 1,
    providerTransactionId: "momo-query-wrong-amount",
    providerStatus: "0",
    occurredAt: new Date("2026-07-19T05:01:00Z"),
    rawPayload: { resultCode: 0, amount: payment.amount - 1 },
  }),
  { now: new Date("2026-07-19T05:01:00Z"), minIntervalMs: 10_000 },
);
const [mismatchPaymentAfter] = await db.select().from(payments).where(eq(payments.id, mismatchPending.data.id));
const [mismatchOrderAfter] = await db.select().from(orders).where(eq(orders.id, mismatchOrder.id));
ok("wrong inquiry amount remains pending", mismatchInquiry.ok && mismatchInquiry.data.status === "pending" && mismatchPaymentAfter.lastProviderError === "payments.errors.invalidProviderResponse" && Number(mismatchOrderAfter.amountPaid) === 0);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

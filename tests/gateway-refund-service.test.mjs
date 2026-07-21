/* Durable gateway refund state machine: return acceptance never implies money
   was refunded; only exact provider evidence posts one cashbook movement. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const service = await import(`${PROJ}/src/lib/payments/refund-service-core.ts`);
const { profiles, orders, payments, returns, paymentRefunds, cashTransactions } = schema;
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

const [manager] = await db.insert(profiles).values({
  id: "00000000-0000-0000-0000-000000000401",
  fullName: "Refund Manager",
  role: "manager",
}).returning();
const [order] = await db.insert(orders).values({
  code: "DH-GATEWAY-REFUND",
  status: "returned",
  paymentStatus: "paid",
  subtotal: money(200_000),
  total: money(200_000),
  amountPaid: money(200_000),
  createdBy: manager.id,
}).returning();
const [payment] = await db.insert(payments).values({
  orderId: order.id,
  status: "confirmed",
  provider: "momo",
  providerTransactionId: "momo-original-001",
  amount: money(200_000),
  method: "momo",
  reference: "LUMA-M-ORIGINAL-001",
  confirmedAt: new Date("2026-07-19T04:00:00Z"),
  createdBy: manager.id,
}).returning();
const [ret] = await db.insert(returns).values({
  code: "TH-GATEWAY-REFUND",
  orderId: order.id,
  refundMethod: "bank_transfer",
  totalRefund: money(75_000),
  createdBy: manager.id,
}).returning();

console.log("1) Durable refund request is idempotent and does not pre-post money");
const pending = await service.createPendingGatewayRefund(db, {
  returnId: ret.id,
  paymentId: payment.id,
  amount: 75_000,
  clientRequestId: "gateway-refund-request-001",
  createdBy: manager.id,
});
const replay = await service.createPendingGatewayRefund(db, {
  returnId: ret.id,
  paymentId: payment.id,
  amount: 75_000,
  clientRequestId: "gateway-refund-request-001",
  createdBy: manager.id,
});
const cashBefore = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, ret.id));
ok("refund request is idempotent", pending.ok && replay.ok && pending.data.id === replay.data.id);
ok("pending refund does not post cashbook", cashBefore.length === 0);

console.log("2) Exact provider confirmation posts once");
const wrong = await service.recordGatewayRefundResult(db, {
  refundId: pending.data.id,
  reference: pending.data.reference,
  amount: 74_999,
  state: "confirmed",
  providerRefundTransactionId: "momo-refund-wrong",
  providerStatus: "0",
  rawPayload: { resultCode: 0, amount: 74999 },
});
const confirmed = await service.recordGatewayRefundResult(db, {
  refundId: pending.data.id,
  reference: pending.data.reference,
  amount: 75_000,
  state: "confirmed",
  providerRefundTransactionId: "momo-refund-001",
  providerStatus: "0",
  rawPayload: { resultCode: 0, amount: 75000 },
});
const duplicate = await service.recordGatewayRefundResult(db, {
  refundId: pending.data.id,
  reference: pending.data.reference,
  amount: 75_000,
  state: "confirmed",
  providerRefundTransactionId: "momo-refund-001",
  providerStatus: "0",
  rawPayload: { resultCode: 0, amount: 75000 },
});
const [refundAfter] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, pending.data.id));
const cashAfter = await db.select().from(cashTransactions).where(eq(cashTransactions.refId, ret.id));
ok("wrong amount remains pending", wrong.ok && wrong.data.status === "pending");
ok("exact evidence confirms refund", confirmed.ok && refundAfter.status === "confirmed" && refundAfter.providerRefundTransactionId === "momo-refund-001");
ok("refund cashbook posts exactly once", duplicate.ok && cashAfter.length === 1 && Number(cashAfter[0].amount) === 75_000);

console.log("3) Cumulative refund cannot exceed original confirmed payment");
const [ret2] = await db.insert(returns).values({
  code: "TH-GATEWAY-REFUND-2",
  orderId: order.id,
  refundMethod: "bank_transfer",
  totalRefund: money(130_000),
  createdBy: manager.id,
}).returning();
const excessive = await service.createPendingGatewayRefund(db, {
  returnId: ret2.id,
  paymentId: payment.id,
  amount: 130_000,
  clientRequestId: "gateway-refund-request-002",
  createdBy: manager.id,
});
ok("over-refund is rejected server-side", !excessive.ok && excessive.error === "payments.errors.refundExceedsPayment");

console.log("4) Refund inquiry claims are durable and throttled");
const [ret3] = await db.insert(returns).values({
  code: "TH-GATEWAY-REFUND-3",
  orderId: order.id,
  refundMethod: "bank_transfer",
  totalRefund: money(50_000),
  createdBy: manager.id,
}).returning();
const pendingQuery = await service.createPendingGatewayRefund(db, {
  returnId: ret3.id,
  paymentId: payment.id,
  amount: 50_000,
  clientRequestId: "gateway-refund-request-003",
  createdBy: manager.id,
});
const submittedAt = new Date("2026-07-19T06:00:00Z");
await service.claimGatewayRefundSubmission(db, pendingQuery.data.id, submittedAt);
const firstClaim = await service.claimGatewayRefundInquiry(db, pendingQuery.data.id, {
  now: submittedAt,
  minIntervalMs: 10_000,
});
const throttledClaim = await service.claimGatewayRefundInquiry(db, pendingQuery.data.id, {
  now: new Date(submittedAt.getTime() + 1_000),
  minIntervalMs: 10_000,
});
const secondClaim = await service.claimGatewayRefundInquiry(db, pendingQuery.data.id, {
  now: new Date(submittedAt.getTime() + 11_000),
  minIntervalMs: 10_000,
});
const [queryMetadata] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, pendingQuery.data.id));
ok("inquiry claim is throttled", firstClaim.ok && firstClaim.data.claimed && throttledClaim.ok && !throttledClaim.data.claimed && secondClaim.ok && secondClaim.data.claimed);
ok("query attempts are durable", queryMetadata.providerQueryAttempts === 2 && queryMetadata.lastProviderCheckedAt?.getTime() === submittedAt.getTime() + 11_000);

const paymentService = await import(`${PROJ}/src/lib/payments/service-core.ts`);
const reconciliation = await paymentService.getPaymentReconciliation(db, { status: "actionable" });
ok("manager queue exposes pending refund without raw payload", reconciliation.ok && reconciliation.data.refunds.some((row) => row.id === pendingQuery.data.id && row.providerQueryAttempts === 2 && !("rawPayload" in row)));

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

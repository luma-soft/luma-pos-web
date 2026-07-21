import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { cashTransactions, paymentRefunds, payments, returns } from "@/db/schema";
import type { GatewayProvider } from "@/lib/payments/gateways";
import type { PaymentActionResult } from "@/lib/payments/service-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

const GATEWAY_PROVIDERS = ["momo", "zalopay", "vnpay"] as const;
const toMoney = (value: number) => value.toFixed(2);

function refundReference(provider: GatewayProvider, clientRequestId: string) {
  const digest = createHash("sha256").update(clientRequestId).digest("hex").slice(0, 24).toUpperCase();
  return `RF-${provider.toUpperCase()}-${digest}`;
}

export async function createPendingGatewayRefund(
  db: DbLike,
  input: {
    returnId: string;
    paymentId: string;
    amount: number;
    clientRequestId: string;
    reference?: string;
    createdBy?: string | null;
  },
): Promise<PaymentActionResult<{ id: string; reference: string; provider: GatewayProvider; existing: boolean }>> {
  const amount = Math.round(input.amount);
  const clientRequestId = input.clientRequestId.trim();
  if (amount <= 0 || clientRequestId.length < 8 || clientRequestId.length > 80) {
    return { ok: false, error: "errors.invalidData" };
  }
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [existing] = await tx.select().from(paymentRefunds)
        .where(eq(paymentRefunds.clientRequestId, clientRequestId)).limit(1);
      if (existing) {
        if (existing.returnId !== input.returnId || existing.paymentId !== input.paymentId || Number(existing.amount) !== amount) {
          throw new Error("REFUND_REQUEST_CONFLICT");
        }
        return { ok: true, data: { id: existing.id, reference: existing.reference, provider: existing.provider as GatewayProvider, existing: true } };
      }

      const [payment] = await tx.select().from(payments)
        .where(eq(payments.id, input.paymentId)).limit(1).for("update");
      const [ret] = await tx.select().from(returns)
        .where(eq(returns.id, input.returnId)).limit(1).for("update");
      if (!payment || !ret || !payment.provider || !GATEWAY_PROVIDERS.includes(payment.provider as GatewayProvider)) {
        throw new Error("REFUND_SOURCE_NOT_FOUND");
      }
      if (!payment.providerTransactionId || !["confirmed", "reconciled", "manual_confirmed", "refunded"].includes(payment.status)) {
        throw new Error("REFUND_SOURCE_NOT_CONFIRMED");
      }
      if (ret.orderId !== payment.orderId) throw new Error("REFUND_ORDER_MISMATCH");

      const [reserved] = await tx.select({ total: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)` })
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.paymentId, payment.id), ne(paymentRefunds.status, "failed")));
      if (Number(reserved?.total ?? 0) + amount > Number(payment.amount) + 1e-9) {
        throw new Error("REFUND_EXCEEDS_PAYMENT");
      }
      const provider = payment.provider as GatewayProvider;
      const reference = input.reference?.trim() || refundReference(provider, clientRequestId);
      const [created] = await tx.insert(paymentRefunds).values({
        returnId: ret.id,
        paymentId: payment.id,
        provider,
        reference,
        clientRequestId,
        amount: toMoney(amount),
        createdBy: input.createdBy ?? null,
      }).returning({ id: paymentRefunds.id });
      return { ok: true, data: { id: created.id, reference, provider, existing: false } };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      REFUND_REQUEST_CONFLICT: "payments.errors.refundRequestConflict",
      REFUND_SOURCE_NOT_FOUND: "payments.errors.refundSourceNotFound",
      REFUND_SOURCE_NOT_CONFIRMED: "payments.errors.refundSourceNotConfirmed",
      REFUND_ORDER_MISMATCH: "payments.errors.refundOrderMismatch",
      REFUND_EXCEEDS_PAYMENT: "payments.errors.refundExceedsPayment",
    };
    if (known[message]) return { ok: false, error: known[message] };
    console.error("createPendingGatewayRefund failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function recordGatewayRefundResult(
  db: DbLike,
  input: {
    refundId: string;
    reference: string;
    amount: number | null;
    state: "confirmed" | "pending" | "failed" | "unknown";
    providerRefundTransactionId: string | null;
    providerStatus: string;
    providerError?: string | null;
    occurredAt?: Date | null;
    rawPayload: Record<string, unknown>;
  },
): Promise<PaymentActionResult<{ status: string; duplicate: boolean }>> {
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [refund] = await tx.select().from(paymentRefunds)
        .where(eq(paymentRefunds.id, input.refundId)).limit(1).for("update");
      if (!refund) throw new Error("REFUND_NOT_FOUND");
      if (refund.status === "confirmed") {
        return { ok: true, data: { status: "confirmed", duplicate: true } };
      }

      const exactReference = input.reference === refund.reference;
      const exactAmount = input.amount === Number(refund.amount);
      const providerTransactionId = input.providerRefundTransactionId?.trim() || null;
      if (input.state === "confirmed" && (!exactReference || !exactAmount || !providerTransactionId)) {
        await tx.update(paymentRefunds).set({
          status: "pending",
          providerStatus: input.providerStatus,
          providerError: "payments.errors.invalidProviderResponse",
          rawPayload: input.rawPayload,
          updatedAt: new Date(),
        }).where(eq(paymentRefunds.id, refund.id));
        return { ok: true, data: { status: "pending", duplicate: false } };
      }

      if (input.state !== "confirmed") {
        const status = input.state === "failed" ? "failed" : "pending";
        await tx.update(paymentRefunds).set({
          status,
          providerRefundTransactionId: providerTransactionId ?? refund.providerRefundTransactionId,
          providerStatus: input.providerStatus,
          providerError: input.providerError?.slice(0, 500) || null,
          rawPayload: input.rawPayload,
          updatedAt: new Date(),
        }).where(eq(paymentRefunds.id, refund.id));
        return { ok: true, data: { status, duplicate: false } };
      }

      const confirmedAt = input.occurredAt ?? new Date();
      await tx.update(paymentRefunds).set({
        status: "confirmed",
        providerRefundTransactionId: providerTransactionId,
        providerStatus: input.providerStatus,
        providerError: null,
        rawPayload: input.rawPayload,
        confirmedAt,
        updatedAt: new Date(),
      }).where(eq(paymentRefunds.id, refund.id));
      const [payment] = await tx.select().from(payments)
        .where(eq(payments.id, refund.paymentId)).limit(1).for("update");
      if (!payment) throw new Error("REFUND_SOURCE_NOT_FOUND");
      await tx.insert(cashTransactions).values({
        code: `RF-${refund.id.slice(0, 8).toUpperCase()}`,
        shiftId: payment.shiftId,
        type: "out",
        fund: "bank",
        amount: refund.amount,
        category: "refund",
        refType: "return",
        refId: refund.returnId,
        note: `Provider refund ${refund.reference}`,
        createdBy: refund.createdBy,
      });
      const [totals] = await tx.select({ total: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)` })
        .from(paymentRefunds)
        .where(and(eq(paymentRefunds.paymentId, payment.id), eq(paymentRefunds.status, "confirmed")));
      if (Number(totals?.total ?? 0) >= Number(payment.amount) - 1e-9) {
        await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, payment.id));
      }
      return { ok: true, data: { status: "confirmed", duplicate: false } };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "REFUND_NOT_FOUND") return { ok: false, error: "errors.invalidData" };
    console.error("recordGatewayRefundResult failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export type GatewayRefundProviderContext = {
  refundId: string;
  provider: GatewayProvider;
  reference: string;
  sourceReference: string;
  sourceProviderTransactionId: string;
  amount: number;
  originalAmount: number;
  paymentCreatedAt: Date;
  returnCode: string;
  status: string;
};

export async function getGatewayRefundProviderContext(
  db: DbLike,
  refundId: string,
): Promise<PaymentActionResult<GatewayRefundProviderContext>> {
  try {
    const [row] = await db.select({ refund: paymentRefunds, payment: payments, returnCode: returns.code })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .innerJoin(returns, eq(returns.id, paymentRefunds.returnId))
      .where(eq(paymentRefunds.id, refundId)).limit(1);
    if (!row || !row.payment.reference || !row.payment.providerTransactionId) {
      return { ok: false, error: "errors.invalidData" };
    }
    return {
      ok: true,
      data: {
        refundId: row.refund.id,
        provider: row.refund.provider as GatewayProvider,
        reference: row.refund.reference,
        sourceReference: row.payment.reference,
        sourceProviderTransactionId: row.payment.providerTransactionId,
        amount: Number(row.refund.amount),
        originalAmount: Number(row.payment.amount),
        paymentCreatedAt: row.payment.createdAt,
        returnCode: row.returnCode,
        status: row.refund.status,
      },
    };
  } catch (error) {
    console.error("getGatewayRefundProviderContext failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function claimGatewayRefundSubmission(
  db: DbLike,
  refundId: string,
  now = new Date(),
): Promise<PaymentActionResult<{ claimed: boolean }>> {
  try {
    const changed = await db.update(paymentRefunds).set({ submittedAt: now, updatedAt: now })
      .where(and(
        eq(paymentRefunds.id, refundId),
        eq(paymentRefunds.status, "pending"),
        isNull(paymentRefunds.submittedAt),
      )).returning({ id: paymentRefunds.id });
    return { ok: true, data: { claimed: changed.length > 0 } };
  } catch (error) {
    console.error("claimGatewayRefundSubmission failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function claimGatewayRefundInquiry(
  db: DbLike,
  refundId: string,
  options: { now?: Date; minIntervalMs?: number } = {},
): Promise<PaymentActionResult<{ claimed: boolean }>> {
  const now = options.now ?? new Date();
  const threshold = new Date(now.getTime() - Math.max(1_000, options.minIntervalMs ?? 10_000));
  try {
    const changed = await db.update(paymentRefunds).set({
      lastProviderCheckedAt: now,
      providerQueryAttempts: sql`${paymentRefunds.providerQueryAttempts} + 1`,
      updatedAt: now,
    }).where(and(
      eq(paymentRefunds.id, refundId),
      inArray(paymentRefunds.status, ["pending", "failed"]),
      sql`${paymentRefunds.submittedAt} is not null`,
      sql`(${paymentRefunds.lastProviderCheckedAt} is null or ${paymentRefunds.lastProviderCheckedAt} <= ${threshold})`,
    )).returning({ id: paymentRefunds.id });
    return { ok: true, data: { claimed: changed.length > 0 } };
  } catch (error) {
    console.error("claimGatewayRefundInquiry failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function recordGatewayRefundTransportError(
  db: DbLike,
  refundId: string,
  error: string,
  providerStatus?: string | null,
): Promise<PaymentActionResult> {
  try {
    const changed = await db.update(paymentRefunds).set({
      providerError: error.slice(0, 500),
      providerStatus: providerStatus?.trim() || null,
      updatedAt: new Date(),
    }).where(and(eq(paymentRefunds.id, refundId), inArray(paymentRefunds.status, ["pending", "failed"])))
      .returning({ id: paymentRefunds.id });
    return changed.length ? { ok: true, data: undefined } : { ok: false, error: "payments.errors.refundNotPending" };
  } catch (cause) {
    console.error("recordGatewayRefundTransportError failed:", cause);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function getGatewayRefundStatus(
  db: DbLike,
  refundId: string,
): Promise<PaymentActionResult<{
  id: string;
  returnId: string;
  paymentId: string;
  provider: string;
  reference: string;
  amount: number;
  status: string;
  providerStatus: string | null;
  providerError: string | null;
  providerRefundTransactionId: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  lastProviderCheckedAt: Date | null;
  providerQueryAttempts: number;
}>> {
  try {
    const [row] = await db.select().from(paymentRefunds).where(eq(paymentRefunds.id, refundId)).limit(1);
    if (!row) return { ok: false, error: "errors.invalidData" };
    return { ok: true, data: {
      id: row.id, returnId: row.returnId, paymentId: row.paymentId,
      provider: row.provider, reference: row.reference, amount: Number(row.amount), status: row.status,
      providerStatus: row.providerStatus, providerError: row.providerError,
      providerRefundTransactionId: row.providerRefundTransactionId,
      submittedAt: row.submittedAt, confirmedAt: row.confirmedAt,
      lastProviderCheckedAt: row.lastProviderCheckedAt, providerQueryAttempts: row.providerQueryAttempts,
    } };
  } catch (error) {
    console.error("getGatewayRefundStatus failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

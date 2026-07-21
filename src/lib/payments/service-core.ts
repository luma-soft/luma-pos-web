import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  cashTransactions,
  customers,
  orders,
  orderItems,
  paymentBankAccounts,
  paymentRefunds,
  paymentWebhookEvents,
  payments,
  returns,
  shifts,
  stockLevels,
  stockMovements,
} from "@/db/schema";
import type { SepayWebhookInput } from "@/lib/payments/sepay";
import type { GatewayProvider } from "@/lib/payments/gateways";
import type { GatewayInquiryResult } from "@/lib/payments/gateway-adapter";
import { consumeTrackedStockLots } from "@/lib/inventory/stock-lot-service";

export type PaymentActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Drizzle's Postgres and PGlite databases expose the same fluent API with
// different generic brands. This core accepts either runtime for production and tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type ConfirmSource = "webhook" | "api" | "manual";

export const SEPAY_PAYMENT_TIMEOUT_MS = 90_000;
export const GATEWAY_PAYMENT_TIMEOUT_MS = 15 * 60_000;
export const GATEWAY_INQUIRY_MIN_INTERVAL_MS = 10_000;

const toMoney = (n: number) => n.toFixed(2);

function safeAmount(value: number) {
  return Math.max(0, Math.round(value));
}

function paymentStatusFor(total: number, paid: number) {
  if (paid >= total - 1e-9) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

async function finalizeDraftOrderInTx(
  tx: DbLike,
  order: typeof orders.$inferSelect,
  paid: number,
) {
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  if (!order.warehouseId || items.length === 0) {
    throw new Error("DRAFT_ORDER_INVALID");
  }

  for (const item of items) {
    const baseQty = Number(item.quantity) * Number(item.unitMultiplier);
    if (!Number.isFinite(baseQty) || baseQty <= 0) {
      throw new Error("DRAFT_ORDER_INVALID");
    }
    await consumeTrackedStockLots(tx, {
      productId: item.productId,
      warehouseId: order.warehouseId,
      quantity: baseQty,
      refType: "order",
      refId: order.id,
      createdBy: order.createdBy,
    });
    await tx
      .insert(stockLevels)
      .values({
        productId: item.productId,
        warehouseId: order.warehouseId,
        quantity: (-baseQty).toFixed(3),
      })
      .onConflictDoUpdate({
        target: [stockLevels.productId, stockLevels.warehouseId],
        set: {
          quantity: sql`${stockLevels.quantity} - ${baseQty.toFixed(3)}`,
          updatedAt: sql`now()`,
        },
      });
    await tx.insert(stockMovements).values({
      productId: item.productId,
      warehouseId: order.warehouseId,
      type: "sale",
      quantity: (-baseQty).toFixed(3),
      refType: "order",
      refId: order.id,
      note: `${order.code} · ${item.quantity} ${item.unitName}`,
      createdBy: order.createdBy,
    });
  }

  const total = Number(order.total);
  const remaining = Math.max(total - paid, 0);
  await tx
    .update(orders)
    .set({
      status: "completed",
      paymentStatus: paymentStatusFor(total, paid),
      updatedAt: sql`now()`,
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, "draft")));
  if (order.customerId) {
    await tx
      .update(customers)
      .set({
        currentDebt: sql`${customers.currentDebt} + ${toMoney(remaining)}`,
        totalSpent: sql`${customers.totalSpent} + ${toMoney(total)}`,
      })
      .where(eq(customers.id, order.customerId));
  }
}

export function generatePaymentReference(prefix = "LUMA") {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

async function confirmPaymentInTx(
  tx: DbLike,
  input: {
    paymentId: string;
    providerTransactionId?: string | null;
    rawMatchedEventId?: string | null;
    gateway?: string | null;
    accountNumber?: string | null;
    confirmedAt?: Date;
    source?: ConfirmSource;
  }
) {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");

  if (payment.status === "confirmed" || payment.status === "reconciled" || payment.status === "manual_confirmed") {
    return { alreadyConfirmed: true };
  }
  if (payment.status !== "pending" && payment.status !== "expired") throw new Error("PAYMENT_NOT_CONFIRMABLE");

  const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const amount = Number(payment.amount);
  const alreadyPaid = Number(order.amountPaid);
  const total = Number(order.total);
  const draftOrder = order.status === "draft";
  const newPaid = Math.min(total, alreadyPaid + amount);
  const confirmedAt = input.confirmedAt ?? new Date();
  const nextPaymentStatus = input.source === "api" ? "reconciled" : input.source === "manual" ? "manual_confirmed" : "confirmed";

  await tx.update(payments).set({
    status: nextPaymentStatus,
    providerTransactionId: input.providerTransactionId ?? payment.providerTransactionId,
    gateway: input.gateway ?? payment.gateway,
    accountNumber: input.accountNumber ?? payment.accountNumber,
    confirmedAt,
    rawMatchedEventId: input.rawMatchedEventId ?? payment.rawMatchedEventId,
  }).where(eq(payments.id, payment.id));

  await tx.update(orders).set({
    amountPaid: toMoney(newPaid),
    paymentStatus: paymentStatusFor(total, newPaid),
    updatedAt: sql`now()`,
  }).where(eq(orders.id, order.id));

  if (draftOrder) {
    await finalizeDraftOrderInTx(tx, order, newPaid);
  } else if (order.customerId) {
    await tx.update(customers).set({
      currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(amount)}, 0)`,
    }).where(eq(customers.id, order.customerId));
  }

  await tx.insert(cashTransactions).values({
    code: generatePaymentReference("PT"),
    shiftId: payment.shiftId ?? order.shiftId ?? null,
    type: "in",
    fund: "bank",
    amount: toMoney(amount),
    category: alreadyPaid > 0 ? "debt_collect" : "sale",
    refType: "order",
    refId: order.id,
    note: payment.reference ?? order.code,
    createdBy: payment.createdBy ?? null,
  });

  return { alreadyConfirmed: false };
}

async function currentShiftIdForProfile(db: DbLike, profileId: string | null | undefined) {
  if (!profileId) return null;
  const [shift] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.userId, profileId), eq(shifts.status, "open")))
    .orderBy(sql`${shifts.openedAt} desc`)
    .limit(1);
  return shift?.id ?? null;
}

export async function createPendingSepayPayment(
  db: DbLike,
  input: {
    orderId: string;
    bankAccountId: string;
    amount: number;
    reference?: string;
    note?: string;
    createdBy?: string | null;
  }
): Promise<PaymentActionResult<{ id: string; reference: string }>> {
  const amount = safeAmount(input.amount);
  if (amount <= 0) return { ok: false, error: "errors.invalidData" };

  try {
    return await db.transaction(async (tx: DbLike) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "completed" && order.status !== "returned" && order.status !== "draft") throw new Error("ORDER_NOT_PAYABLE");

      const [bankAccount] = await tx
        .select()
        .from(paymentBankAccounts)
        .where(and(eq(paymentBankAccounts.id, input.bankAccountId), eq(paymentBankAccounts.enabled, true)))
        .limit(1);
      if (!bankAccount || bankAccount.provider !== "sepay") throw new Error("BANK_ACCOUNT_NOT_FOUND");

      const remaining = Math.max(0, Number(order.total) - Number(order.amountPaid));
      if (amount > remaining + 1e-9) throw new Error("AMOUNT_EXCEEDS_REMAINING");

      const reference = input.reference?.trim() || generatePaymentReference("LUMA");
      const [existing] = await tx
        .select({
          id: payments.id,
          reference: payments.reference,
          amount: payments.amount,
          bankAccountId: payments.bankAccountId,
          status: payments.status,
        })
        .from(payments)
        .where(and(
          eq(payments.orderId, order.id),
          eq(payments.provider, "sepay"),
          eq(payments.reference, reference),
        ))
        .limit(1);
      if (existing) {
        if (
          Number(existing.amount) !== amount ||
          existing.bankAccountId !== bankAccount.id
        ) {
          throw new Error("REFERENCE_CONFLICT");
        }
        return { ok: true, data: { id: existing.id, reference } };
      }
      const shiftId = await currentShiftIdForProfile(tx, input.createdBy);
      const [payment] = await tx.insert(payments).values({
        orderId: order.id,
        shiftId,
        amount: toMoney(amount),
        method: "bank_transfer",
        status: "pending",
        provider: "sepay",
        bankAccountId: bankAccount.id,
        gateway: bankAccount.gateway || bankAccount.bankCode,
        accountNumber: bankAccount.accountNumber,
        reference,
        note: input.note?.trim() || null,
        createdBy: input.createdBy ?? null,
      }).returning({ id: payments.id, reference: payments.reference });

      return { ok: true, data: { id: payment.id, reference: payment.reference ?? reference } };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      ORDER_NOT_FOUND: "errors.invalidData",
      ORDER_NOT_PAYABLE: "orders.errors.notPayable",
      BANK_ACCOUNT_NOT_FOUND: "payments.errors.bankAccountNotFound",
      AMOUNT_EXCEEDS_REMAINING: "orders.errors.nothingToPay",
      REFERENCE_CONFLICT: "payments.errors.referenceConflict",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createPendingSepayPayment failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function createPendingGatewayPayment(
  db: DbLike,
  input: {
    orderId: string;
    provider: GatewayProvider;
    amount: number;
    reference: string;
    clientRequestId: string;
    note?: string;
    createdBy?: string | null;
  },
): Promise<PaymentActionResult<{ id: string; reference: string; existing: boolean }>> {
  const amount = safeAmount(input.amount);
  const reference = input.reference.trim();
  const clientRequestId = input.clientRequestId.trim();
  if (
    amount <= 0 ||
    !["momo", "zalopay", "vnpay"].includes(input.provider) ||
    reference.length < 4 ||
    reference.length > 100 ||
    clientRequestId.length < 8 ||
    clientRequestId.length > 80
  ) {
    return { ok: false, error: "errors.invalidData" };
  }

  try {
    return await db.transaction(async (tx: DbLike) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "completed" && order.status !== "returned" && order.status !== "draft") throw new Error("ORDER_NOT_PAYABLE");

      const [existing] = await tx
        .select()
        .from(payments)
        .where(and(
          eq(payments.provider, input.provider),
          eq(payments.clientRequestId, clientRequestId),
        ))
        .limit(1);
      if (existing) {
        if (
          existing.orderId !== order.id ||
          Number(existing.amount) !== amount
        ) {
          throw new Error("REFERENCE_CONFLICT");
        }
        return {
          ok: true,
          data: { id: existing.id, reference: existing.reference ?? reference, existing: true },
        };
      }

      const [sameReference] = await tx
        .select({ id: payments.id, orderId: payments.orderId, amount: payments.amount })
        .from(payments)
        .where(and(
          eq(payments.provider, input.provider),
          eq(payments.reference, reference),
        ))
        .limit(1);
      if (sameReference) throw new Error("REFERENCE_CONFLICT");

      const remaining = Math.max(0, Number(order.total) - Number(order.amountPaid));
      if (amount > remaining + 1e-9) throw new Error("AMOUNT_EXCEEDS_REMAINING");
      const shiftId = await currentShiftIdForProfile(tx, input.createdBy);
      const [payment] = await tx.insert(payments).values({
        orderId: order.id,
        shiftId,
        amount: toMoney(amount),
        method: input.provider,
        status: "pending",
        provider: input.provider,
        clientRequestId,
        reference,
        expiresAt: new Date(Date.now() + GATEWAY_PAYMENT_TIMEOUT_MS),
        note: input.note?.trim() || null,
        createdBy: input.createdBy ?? null,
      }).returning({ id: payments.id });
      return {
        ok: true,
        data: { id: payment.id, reference, existing: false },
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      ORDER_NOT_FOUND: "errors.invalidData",
      ORDER_NOT_PAYABLE: "orders.errors.notPayable",
      AMOUNT_EXCEEDS_REMAINING: "orders.errors.nothingToPay",
      REFERENCE_CONFLICT: "payments.errors.referenceConflict",
    };
    if (known[message]) return { ok: false, error: known[message] };
    console.error("createPendingGatewayPayment failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function attachGatewayIntent(
  db: DbLike,
  input: {
    paymentId: string;
    checkoutUrl?: string | null;
    deepLink?: string | null;
    qrPayload?: string | null;
    expiresAt?: Date;
    providerStatus?: string | null;
    providerError?: string | null;
  },
): Promise<PaymentActionResult> {
  try {
    const changed = await db
      .update(payments)
      .set({
        checkoutUrl: input.checkoutUrl?.trim() || null,
        deepLink: input.deepLink?.trim() || null,
        qrPayload: input.qrPayload?.trim() || null,
        expiresAt: input.expiresAt ?? new Date(Date.now() + GATEWAY_PAYMENT_TIMEOUT_MS),
        lastProviderStatus: input.providerStatus?.trim() || null,
        lastProviderError: input.providerError?.trim() || null,
      })
      .where(and(
        eq(payments.id, input.paymentId),
        eq(payments.status, "pending"),
        inArray(payments.provider, ["momo", "zalopay", "vnpay"]),
      ))
      .returning({ id: payments.id });
    return changed.length > 0
      ? { ok: true, data: undefined }
      : { ok: false, error: "payments.errors.notConfirmable" };
  } catch (error) {
    console.error("attachGatewayIntent failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function failGatewayPayment(
  db: DbLike,
  input: {
    paymentId: string;
    providerStatus?: string | null;
    providerError: string;
  },
): Promise<PaymentActionResult> {
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [pending] = await tx
        .select({ orderId: payments.orderId })
        .from(payments)
        .where(and(
          eq(payments.id, input.paymentId),
          eq(payments.status, "pending"),
          inArray(payments.provider, ["momo", "zalopay", "vnpay"]),
        ))
        .limit(1);
      if (!pending) return { ok: false, error: "payments.errors.notConfirmable" };
      const changed = await tx
        .update(payments)
        .set({
          status: "failed",
          lastProviderStatus: input.providerStatus?.trim() || null,
          lastProviderError: input.providerError.trim().slice(0, 500),
        })
        .where(and(
          eq(payments.id, input.paymentId),
          eq(payments.status, "pending"),
          inArray(payments.provider, ["momo", "zalopay", "vnpay"]),
        ))
        .returning({ id: payments.id });
      if (changed.length === 0) {
        return { ok: false, error: "payments.errors.notConfirmable" };
      }
      // A provider setup rejection must not leave a payable draft shell.
      await tx
        .update(orders)
        .set({ status: "cancelled", updatedAt: sql`now()` })
        .where(and(eq(orders.id, pending.orderId), eq(orders.status, "draft")));
      return { ok: true, data: undefined };
    });
  } catch (error) {
    console.error("failGatewayPayment failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function cancelDraftOrder(
  db: DbLike,
  orderId: string,
): Promise<PaymentActionResult> {
  try {
    await db
      .update(orders)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(and(eq(orders.id, orderId), eq(orders.status, "draft")));
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("cancelDraftOrder failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export type GatewayPaymentStatus = {
  id: string;
  orderId: string;
  provider: string;
  status: string;
  amount: number;
  reference: string;
  checkoutUrl: string | null;
  deepLink: string | null;
  qrPayload: string | null;
  expiresAt: Date;
  confirmedAt: Date | null;
  providerTransactionId: string | null;
  providerStatus: string | null;
  providerError: string | null;
};

export async function getGatewayPaymentStatus(
  db: DbLike,
  paymentId: string,
): Promise<PaymentActionResult<GatewayPaymentStatus>> {
  try {
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.id, paymentId),
        inArray(payments.provider, ["momo", "zalopay", "vnpay"]),
      ))
      .limit(1);
    if (!payment || !payment.provider || !payment.reference) {
      return { ok: false, error: "errors.invalidData" };
    }
    const expiresAt = payment.expiresAt ?? new Date(payment.createdAt.getTime() + GATEWAY_PAYMENT_TIMEOUT_MS);
    let status = payment.status;
    if (status === "pending" && expiresAt.getTime() <= Date.now()) {
      await db
        .update(payments)
        .set({ status: "expired" })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      status = "expired";
    }
    return {
      ok: true,
      data: {
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        status,
        amount: Number(payment.amount),
        reference: payment.reference,
        checkoutUrl: payment.checkoutUrl,
        deepLink: payment.deepLink,
        qrPayload: payment.qrPayload,
        expiresAt,
        confirmedAt: payment.confirmedAt,
        providerTransactionId: payment.providerTransactionId,
        providerStatus: payment.lastProviderStatus,
        providerError: payment.lastProviderError,
      },
    };
  } catch (error) {
    console.error("getGatewayPaymentStatus failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function recordGatewayCallbackAndMatch(
  db: DbLike,
  input: {
    provider: GatewayProvider;
    providerEventId: string;
    reference: string | null;
    amount: number | null;
    providerTransactionId: string | null;
    successful: boolean;
    occurredAt?: Date | null;
    rawPayload: Record<string, unknown>;
    evidenceStatus?: "verified" | "queried";
  },
): Promise<PaymentActionResult<{ matched: boolean; duplicate: boolean; reason?: string }>> {
  const providerEventId = input.providerEventId.trim();
  if (!providerEventId || input.amount == null || input.amount < 0) {
    return { ok: false, error: "errors.invalidData" };
  }
  const callbackAmount = input.amount;
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [existing] = await tx
        .select()
        .from(paymentWebhookEvents)
        .where(and(
          eq(paymentWebhookEvents.provider, input.provider),
          eq(paymentWebhookEvents.providerEventId, providerEventId),
        ))
        .limit(1);
      if (existing) {
        return {
          ok: true,
          data: {
            matched: existing.matchStatus === "matched",
            duplicate: true,
            ...(existing.matchReason ? { reason: existing.matchReason } : {}),
          },
        };
      }

      const [event] = await tx.insert(paymentWebhookEvents).values({
        provider: input.provider,
        providerEventId,
        referenceCode: input.reference,
        transferType: input.successful ? "in" : "status",
        transferAmount: toMoney(callbackAmount),
        transactionDate: input.occurredAt ?? null,
        rawPayload: input.rawPayload,
        status: input.evidenceStatus ?? "verified",
      }).returning();

      if (!input.successful) {
        await tx.update(paymentWebhookEvents).set({
          matchStatus: "ignored",
          matchReason: "provider_not_successful",
          updatedAt: new Date(),
        }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, duplicate: false, reason: "provider_not_successful" } };
      }
      if (!input.reference) {
        await tx.update(paymentWebhookEvents).set({
          matchStatus: "unmatched",
          matchReason: "missing_reference",
          updatedAt: new Date(),
        }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, duplicate: false, reason: "missing_reference" } };
      }

      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(
          eq(payments.provider, input.provider),
          eq(payments.reference, input.reference),
        ))
        .limit(1)
        .for("update");
      if (!payment) {
        await tx.update(paymentWebhookEvents).set({
          matchStatus: "unmatched",
          matchReason: "pending_payment_not_found",
          updatedAt: new Date(),
        }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, duplicate: false, reason: "pending_payment_not_found" } };
      }
      if (Number(payment.amount) !== callbackAmount) {
        await tx.update(paymentWebhookEvents).set({
          matchedPaymentId: payment.id,
          matchStatus: "wrong_amount",
          matchReason: "amount_mismatch",
          updatedAt: new Date(),
        }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, duplicate: false, reason: "amount_mismatch" } };
      }

      await tx.update(paymentWebhookEvents).set({
        matchedPaymentId: payment.id,
        matchStatus: "matched",
        matchReason: null,
        updatedAt: new Date(),
      }).where(eq(paymentWebhookEvents.id, event.id));
      await confirmPaymentInTx(tx, {
        paymentId: payment.id,
        providerTransactionId: input.providerTransactionId || providerEventId,
        rawMatchedEventId: event.id,
        confirmedAt: input.occurredAt ?? undefined,
        gateway: input.provider,
        source: "webhook",
      });
      return { ok: true, data: { matched: true, duplicate: false } };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PAYMENT_NOT_CONFIRMABLE") {
      return { ok: false, error: "payments.errors.notConfirmable" };
    }
    console.error("recordGatewayCallbackAndMatch failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export type GatewayInquiryPayment = {
  paymentId: string;
  provider: GatewayProvider;
  reference: string;
  amount: number;
  orderCode: string;
  createdAt: Date;
};

export async function refreshGatewayPaymentFromInquiry(
  db: DbLike,
  paymentId: string,
  inquiry: (payment: GatewayInquiryPayment) => Promise<GatewayInquiryResult>,
  options: { now?: Date; minIntervalMs?: number } = {},
): Promise<PaymentActionResult<GatewayPaymentStatus & { queried: boolean }>> {
  const now = options.now ?? new Date();
  const minIntervalMs = Math.max(1_000, options.minIntervalMs ?? GATEWAY_INQUIRY_MIN_INTERVAL_MS);
  const queryBefore = new Date(now.getTime() - minIntervalMs);

  try {
    const claimed = await db
      .update(payments)
      .set({
        lastProviderCheckedAt: now,
        providerQueryAttempts: sql`${payments.providerQueryAttempts} + 1`,
      })
      .where(and(
        eq(payments.id, paymentId),
        eq(payments.status, "pending"),
        inArray(payments.provider, ["momo", "zalopay", "vnpay"]),
        or(
          isNull(payments.lastProviderCheckedAt),
          lte(payments.lastProviderCheckedAt, queryBefore),
        ),
      ))
      .returning({ id: payments.id });

    if (claimed.length === 0) {
      const current = await getGatewayPaymentStatus(db, paymentId);
      return current.ok
        ? { ok: true, data: { ...current.data, queried: false } }
        : current;
    }

    const [row] = await db
      .select({ payment: payments, orderCode: orders.code })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!row?.payment.provider || !row.payment.reference) {
      return { ok: false, error: "errors.invalidData" };
    }

    const ownedPayment: GatewayInquiryPayment = {
      paymentId: row.payment.id,
      provider: row.payment.provider as GatewayProvider,
      reference: row.payment.reference,
      amount: Number(row.payment.amount),
      orderCode: row.orderCode,
      createdAt: row.payment.createdAt,
    };

    let result: GatewayInquiryResult;
    try {
      result = await inquiry(ownedPayment);
    } catch (error) {
      console.error(`Gateway inquiry ${ownedPayment.provider} failed:`, error);
      result = { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
    }

    if (!result.ok) {
      await db.update(payments).set({
        lastProviderStatus: result.providerStatus?.trim() || null,
        lastProviderError: result.error.slice(0, 500),
      }).where(eq(payments.id, paymentId));
    } else {
      const exactReference = result.reference === ownedPayment.reference;
      const exactAmount = result.amount === ownedPayment.amount;
      const providerTransactionId = result.providerTransactionId?.trim() || null;
      const invalidConfirmation = result.state === "confirmed" && (!exactReference || !exactAmount || !providerTransactionId);

      await db.update(payments).set({
        lastProviderStatus: result.providerStatus.trim() || null,
        lastProviderError: invalidConfirmation ? "payments.errors.invalidProviderResponse" : null,
      }).where(eq(payments.id, paymentId));

      if (result.state === "confirmed" && !invalidConfirmation && providerTransactionId) {
        const matched = await recordGatewayCallbackAndMatch(db, {
          provider: ownedPayment.provider,
          providerEventId: `${ownedPayment.provider}:query:${providerTransactionId}:${result.providerStatus}`,
          reference: result.reference,
          amount: result.amount,
          providerTransactionId,
          successful: true,
          occurredAt: result.occurredAt,
          rawPayload: result.rawPayload,
          evidenceStatus: "queried",
        });
        if (!matched.ok) return matched;
      } else if (result.state === "failed" && exactReference) {
        await failGatewayPayment(db, {
          paymentId,
          providerStatus: result.providerStatus,
          providerError: "payments.errors.providerRejected",
        });
      }
    }

    const current = await getGatewayPaymentStatus(db, paymentId);
    return current.ok
      ? { ok: true, data: { ...current.data, queried: true } }
      : current;
  } catch (error) {
    console.error("refreshGatewayPaymentFromInquiry failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function confirmPaymentFromProvider(
  db: DbLike,
  input: {
    paymentId: string;
    providerTransactionId?: string | null;
    rawMatchedEventId?: string | null;
    gateway?: string | null;
    accountNumber?: string | null;
    confirmedAt?: Date;
    source?: ConfirmSource;
  }
): Promise<PaymentActionResult<{ alreadyConfirmed: boolean }>> {
  try {
    return await db.transaction(async (tx: DbLike) => {
      return { ok: true, data: await confirmPaymentInTx(tx, input) };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      PAYMENT_NOT_FOUND: "errors.invalidData",
      ORDER_NOT_FOUND: "errors.invalidData",
      PAYMENT_NOT_CONFIRMABLE: "payments.errors.notConfirmable",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("confirmPaymentFromProvider failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function expirePendingPayment(db: DbLike, paymentId: string): Promise<PaymentActionResult> {
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [pending] = await tx
        .select({ orderId: payments.orderId, status: payments.status })
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1);
      if (!pending) return { ok: false, error: "errors.invalidData" };
      if (pending.status === "expired") return { ok: true, data: undefined };
      if (pending.status !== "pending") {
        return { ok: false, error: "payments.errors.notConfirmable" };
      }
      const changed = await tx
        .update(payments)
        .set({ status: "expired" })
        .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
        .returning({ id: payments.id });
      if (changed.length === 0) {
        return { ok: false, error: "payments.errors.notConfirmable" };
      }
      await tx
        .update(orders)
        .set({ status: "cancelled", updatedAt: sql`now()` })
        .where(and(eq(orders.id, pending.orderId), eq(orders.status, "draft")));
      return { ok: true, data: undefined };
    });
  } catch (e) {
    console.error("expirePendingPayment failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function getSepayPaymentStatus(
  db: DbLike,
  paymentId: string
): Promise<PaymentActionResult<{
  id: string;
  orderId: string;
  status: string;
  amount: number;
  reference: string | null;
  confirmedAt: Date | null;
  providerTransactionId: string | null;
  expiresAt: Date;
}>> {
  try {
    const [payment] = await db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        status: payments.status,
        amount: payments.amount,
        reference: payments.reference,
        confirmedAt: payments.confirmedAt,
        providerTransactionId: payments.providerTransactionId,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.provider, "sepay")))
      .limit(1);
    if (!payment) return { ok: false, error: "errors.invalidData" };
    let status = payment.status;
    const expiresAt = new Date(
      payment.createdAt.getTime() + SEPAY_PAYMENT_TIMEOUT_MS,
    );
    if (status === "pending" && expiresAt.getTime() <= Date.now()) {
      await db.transaction(async (tx: DbLike) => {
        await tx
          .update(payments)
          .set({ status: "expired" })
          .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")));
        await tx
          .update(orders)
          .set({ status: "cancelled", updatedAt: sql`now()` })
          .where(and(eq(orders.id, payment.orderId), eq(orders.status, "draft")));
      });
      status = "expired";
    }
    return {
      ok: true,
      data: {
        ...payment,
        status,
        amount: Number(payment.amount),
        expiresAt,
      },
    };
  } catch (e) {
    console.error("getSepayPaymentStatus failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function getPaymentReconciliation(
  db: DbLike,
  input: {
    status?: "actionable" | "all" | "pending" | "expired" | "failed" | "confirmed" | "reconciled";
    limit?: number;
  } = {},
): Promise<PaymentActionResult<{
  generatedAt: string;
  summary: {
    pending: number;
    expired: number;
    failed: number;
    unmatchedEvents: number;
    wrongAmountEvents: number;
    pendingRefunds: number;
    failedRefunds: number;
  };
  payments: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
}>> {
  try {
    const staleBefore = new Date(Date.now() - SEPAY_PAYMENT_TIMEOUT_MS);
    await db
      .update(payments)
      .set({ status: "expired" })
      .where(and(
        eq(payments.provider, "sepay"),
        eq(payments.status, "pending"),
        lt(payments.createdAt, staleBefore),
      ));

    const status = input.status ?? "actionable";
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
    const paymentFilter = status === "all"
      ? isNotNull(payments.provider)
      : status === "actionable"
        ? inArray(payments.status, ["pending", "expired", "failed"])
        : eq(payments.status, status);
    const refundFilter = status === "all"
      ? sql`true`
      : status === "actionable"
        ? inArray(paymentRefunds.status, ["pending", "failed"])
        : ["pending", "failed", "confirmed"].includes(status)
          ? eq(paymentRefunds.status, status)
          : sql`false`;

    const [paymentRows, eventRows, paymentCounts, eventCounts, refundRows, refundCounts] = await Promise.all([
      db
        .select({
          id: payments.id,
          orderId: payments.orderId,
          orderCode: orders.code,
          status: payments.status,
          provider: payments.provider,
          amount: payments.amount,
          method: payments.method,
          reference: payments.reference,
          gateway: payments.gateway,
          accountNumber: payments.accountNumber,
          providerTransactionId: payments.providerTransactionId,
          rawMatchedEventId: payments.rawMatchedEventId,
          createdAt: payments.createdAt,
          confirmedAt: payments.confirmedAt,
        })
        .from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(and(isNotNull(payments.provider), paymentFilter))
        .orderBy(desc(payments.createdAt))
        .limit(limit),
      db
        .select({
          id: paymentWebhookEvents.id,
          provider: paymentWebhookEvents.provider,
          providerEventId: paymentWebhookEvents.providerEventId,
          matchedPaymentId: paymentWebhookEvents.matchedPaymentId,
          referenceCode: paymentWebhookEvents.referenceCode,
          accountNumber: paymentWebhookEvents.accountNumber,
          gateway: paymentWebhookEvents.gateway,
          transferType: paymentWebhookEvents.transferType,
          transferAmount: paymentWebhookEvents.transferAmount,
          transactionDate: paymentWebhookEvents.transactionDate,
          matchStatus: paymentWebhookEvents.matchStatus,
          matchReason: paymentWebhookEvents.matchReason,
          createdAt: paymentWebhookEvents.createdAt,
        })
        .from(paymentWebhookEvents)
        .where(inArray(paymentWebhookEvents.matchStatus, ["unmatched", "wrong_amount"]))
        .orderBy(desc(paymentWebhookEvents.createdAt))
        .limit(limit),
      db
        .select({
          status: payments.status,
          count: sql<number>`count(*)::int`,
        })
        .from(payments)
        .where(isNotNull(payments.provider))
        .groupBy(payments.status),
      db
        .select({
          status: paymentWebhookEvents.matchStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(paymentWebhookEvents)
        .where(inArray(paymentWebhookEvents.matchStatus, ["unmatched", "wrong_amount"]))
        .groupBy(paymentWebhookEvents.matchStatus),
      db
        .select({
          id: paymentRefunds.id,
          returnId: paymentRefunds.returnId,
          returnCode: returns.code,
          paymentId: paymentRefunds.paymentId,
          provider: paymentRefunds.provider,
          reference: paymentRefunds.reference,
          amount: paymentRefunds.amount,
          status: paymentRefunds.status,
          providerStatus: paymentRefunds.providerStatus,
          providerError: paymentRefunds.providerError,
          providerRefundTransactionId: paymentRefunds.providerRefundTransactionId,
          submittedAt: paymentRefunds.submittedAt,
          lastProviderCheckedAt: paymentRefunds.lastProviderCheckedAt,
          providerQueryAttempts: paymentRefunds.providerQueryAttempts,
          createdAt: paymentRefunds.createdAt,
          confirmedAt: paymentRefunds.confirmedAt,
        })
        .from(paymentRefunds)
        .innerJoin(returns, eq(returns.id, paymentRefunds.returnId))
        .where(refundFilter)
        .orderBy(desc(paymentRefunds.createdAt))
        .limit(limit),
      db
        .select({ status: paymentRefunds.status, count: sql<number>`count(*)::int` })
        .from(paymentRefunds)
        .groupBy(paymentRefunds.status),
    ]);
    const paymentCount = Object.fromEntries(
      paymentCounts.map((row: { status: string; count: number }) => [row.status, Number(row.count)]),
    );
    const eventCount = Object.fromEntries(
      eventCounts.map((row: { status: string; count: number }) => [row.status, Number(row.count)]),
    );
    const refundCount = Object.fromEntries(
      refundCounts.map((row: { status: string; count: number }) => [row.status, Number(row.count)]),
    );
    const maskAccount = (value: string | null) => {
      if (!value) return null;
      const suffix = value.slice(-4);
      return suffix.length === value.length ? suffix : `••••${suffix}`;
    };
    return {
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        summary: {
          pending: paymentCount.pending ?? 0,
          expired: paymentCount.expired ?? 0,
          failed: paymentCount.failed ?? 0,
          unmatchedEvents: eventCount.unmatched ?? 0,
          wrongAmountEvents: eventCount.wrong_amount ?? 0,
          pendingRefunds: refundCount.pending ?? 0,
          failedRefunds: refundCount.failed ?? 0,
        },
        payments: paymentRows.map((row: Record<string, unknown>) => ({
          ...row,
          amount: Number(row.amount),
          accountNumber: maskAccount(row.accountNumber as string | null),
        })),
        events: eventRows.map((row: Record<string, unknown>) => ({
          ...row,
          transferAmount: Number(row.transferAmount),
          accountNumber: maskAccount(row.accountNumber as string | null),
        })),
        refunds: refundRows.map((row: Record<string, unknown>) => ({
          ...row,
          amount: Number(row.amount),
        })),
      },
    };
  } catch (error) {
    console.error("getPaymentReconciliation failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function recordSepayWebhookEvent(
  db: DbLike,
  input: SepayWebhookInput
): Promise<PaymentActionResult<{ eventId: string; duplicate: boolean }>> {
  try {
    const [existing] = await db
      .select({ id: paymentWebhookEvents.id })
      .from(paymentWebhookEvents)
      .where(and(
        eq(paymentWebhookEvents.provider, "sepay"),
        eq(paymentWebhookEvents.providerEventId, input.providerEventId),
      ))
      .limit(1);
    if (existing) return { ok: true, data: { eventId: existing.id, duplicate: true } };

    const [event] = await db.insert(paymentWebhookEvents).values({
      provider: "sepay",
      providerEventId: input.providerEventId,
      referenceCode: input.referenceCode,
      accountNumber: input.accountNumber,
      subAccount: input.subAccount,
      gateway: input.gateway,
      transferType: input.transferType,
      transferAmount: toMoney(input.transferAmount),
      transactionDate: input.transactionDate,
      content: input.content,
      rawPayload: input.rawPayload,
    }).returning({ id: paymentWebhookEvents.id });

    return { ok: true, data: { eventId: event.id, duplicate: false } };
  } catch (e) {
    console.error("recordSepayWebhookEvent failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function reconcilePaymentWithEvent(
  db: DbLike,
  input: {
    paymentId: string;
    eventId: string;
    actorId?: string | null;
  }
): Promise<PaymentActionResult<{ alreadyReconciled: boolean }>> {
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, input.paymentId))
        .limit(1)
        .for("update");
      const [event] = await tx
        .select()
        .from(paymentWebhookEvents)
        .where(eq(paymentWebhookEvents.id, input.eventId))
        .limit(1)
        .for("update");
      if (!payment || !event) throw new Error("RECONCILIATION_NOT_FOUND");

      if (
        payment.rawMatchedEventId === event.id &&
        event.matchedPaymentId === payment.id &&
        ["confirmed", "reconciled", "manual_confirmed"].includes(payment.status)
      ) {
        return { ok: true, data: { alreadyReconciled: true } };
      }
      if (payment.status !== "pending" && payment.status !== "expired") {
        throw new Error("PAYMENT_NOT_CONFIRMABLE");
      }
      if (event.matchedPaymentId && event.matchedPaymentId !== payment.id) {
        throw new Error("EVENT_ALREADY_MATCHED");
      }
      if (event.transferType !== "in") throw new Error("EVENT_NOT_INCOMING");
      if (!payment.provider || payment.provider !== event.provider) {
        throw new Error("PROVIDER_MISMATCH");
      }
      const sameBankAccount = Boolean(
        payment.bankAccountId &&
        event.bankAccountId &&
        payment.bankAccountId === event.bankAccountId,
      );
      const sameAccountNumber = Boolean(
        payment.accountNumber &&
        event.accountNumber &&
        payment.accountNumber === event.accountNumber,
      );
      if (payment.provider === "sepay") {
        if (!sameBankAccount && !sameAccountNumber) {
          throw new Error("ACCOUNT_MISMATCH");
        }
      } else if (
        !["momo", "zalopay", "vnpay"].includes(payment.provider) ||
        !["verified", "queried"].includes(event.status)
      ) {
        throw new Error("EVENT_NOT_VERIFIED");
      }
      if (Number(payment.amount) !== Number(event.transferAmount)) {
        throw new Error("AMOUNT_MISMATCH");
      }

      await tx
        .update(paymentWebhookEvents)
        .set({
          bankAccountId: event.bankAccountId ?? payment.bankAccountId,
          matchedPaymentId: payment.id,
          matchStatus: "matched",
          matchReason: "manager_reconciled",
          updatedAt: new Date(),
        })
        .where(eq(paymentWebhookEvents.id, event.id));

      await confirmPaymentInTx(tx, {
        paymentId: payment.id,
        providerTransactionId: event.providerEventId,
        rawMatchedEventId: event.id,
        gateway: event.gateway,
        accountNumber: event.accountNumber,
        confirmedAt: event.transactionDate ?? undefined,
        source: "api",
      });
      return { ok: true, data: { alreadyReconciled: false } };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      RECONCILIATION_NOT_FOUND: "errors.invalidData",
      PAYMENT_NOT_CONFIRMABLE: "payments.errors.notConfirmable",
      EVENT_ALREADY_MATCHED: "payments.errors.eventAlreadyMatched",
      EVENT_NOT_INCOMING: "payments.errors.eventNotIncoming",
      PROVIDER_MISMATCH: "payments.errors.providerMismatch",
      ACCOUNT_MISMATCH: "payments.errors.accountMismatch",
      EVENT_NOT_VERIFIED: "payments.errors.eventNotVerified",
      AMOUNT_MISMATCH: "payments.errors.amountMismatch",
    };
    if (known[message]) return { ok: false, error: known[message] };
    console.error("reconcilePaymentWithEvent failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function matchSepayWebhookEvent(
  db: DbLike,
  eventId: string
): Promise<PaymentActionResult<{ matched: boolean; reason?: string }>> {
  try {
    return await db.transaction(async (tx: DbLike) => {
      const [event] = await tx.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.id, eventId)).limit(1);
      if (!event) throw new Error("EVENT_NOT_FOUND");
      if (event.matchStatus === "matched" && event.matchedPaymentId) {
        await confirmPaymentInTx(tx, {
          paymentId: event.matchedPaymentId,
          providerTransactionId: event.providerEventId,
          rawMatchedEventId: event.id,
          gateway: event.gateway,
          accountNumber: event.accountNumber,
          source: "webhook",
        });
        return { ok: true, data: { matched: true } };
      }
      if (event.transferType !== "in") {
        await tx.update(paymentWebhookEvents).set({ matchStatus: "ignored", matchReason: "not_incoming_transfer" }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, reason: "not_incoming_transfer" } };
      }

      const [bankAccount] = await tx
        .select()
        .from(paymentBankAccounts)
        .where(and(
          eq(paymentBankAccounts.provider, "sepay"),
          eq(paymentBankAccounts.accountNumber, event.accountNumber ?? ""),
          eq(paymentBankAccounts.enabled, true),
        ))
        .limit(1);
      if (!bankAccount) {
        await tx.update(paymentWebhookEvents).set({ matchStatus: "unmatched", matchReason: "bank_account_not_found" }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, reason: "bank_account_not_found" } };
      }

      const reference = event.referenceCode?.trim();
      if (!reference) {
        await tx.update(paymentWebhookEvents).set({ bankAccountId: bankAccount.id, matchStatus: "unmatched", matchReason: "missing_reference" }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, reason: "missing_reference" } };
      }

      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(
          eq(payments.provider, "sepay"),
          eq(payments.status, "pending"),
          eq(payments.reference, reference),
          eq(payments.bankAccountId, bankAccount.id),
        ))
        .limit(1);
      if (!payment) {
        await tx.update(paymentWebhookEvents).set({ bankAccountId: bankAccount.id, matchStatus: "unmatched", matchReason: "pending_payment_not_found" }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, reason: "pending_payment_not_found" } };
      }

      if (Number(payment.amount) !== Number(event.transferAmount)) {
        await tx.update(paymentWebhookEvents).set({ bankAccountId: bankAccount.id, matchedPaymentId: payment.id, matchStatus: "wrong_amount", matchReason: "amount_mismatch" }).where(eq(paymentWebhookEvents.id, event.id));
        return { ok: true, data: { matched: false, reason: "amount_mismatch" } };
      }

      await tx.update(paymentWebhookEvents).set({
        bankAccountId: bankAccount.id,
        matchedPaymentId: payment.id,
        matchStatus: "matched",
        matchReason: null,
      }).where(eq(paymentWebhookEvents.id, event.id));

      await confirmPaymentInTx(tx, {
        paymentId: payment.id,
        providerTransactionId: event.providerEventId,
        rawMatchedEventId: event.id,
        gateway: event.gateway,
        accountNumber: event.accountNumber,
        confirmedAt: event.transactionDate ?? undefined,
        source: "webhook",
      });
      return { ok: true, data: { matched: true } };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "EVENT_NOT_FOUND") return { ok: false, error: "errors.invalidData" };
    console.error("matchSepayWebhookEvent failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

import { and, eq, sql } from "drizzle-orm";
import {
  cashTransactions,
  customers,
  orders,
  paymentBankAccounts,
  paymentWebhookEvents,
  payments,
  shifts,
} from "@/db/schema";
import type { SepayWebhookInput } from "@/lib/payments/sepay";

export type PaymentActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Drizzle's Postgres and PGlite databases expose the same fluent API with
// different generic brands. This core accepts either runtime for production and tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type ConfirmSource = "webhook" | "api" | "manual";

const toMoney = (n: number) => n.toFixed(2);

function safeAmount(value: number) {
  return Math.max(0, Math.round(value));
}

function paymentStatusFor(total: number, paid: number) {
  if (paid >= total - 1e-9) return "paid";
  return paid > 0 ? "partial" : "unpaid";
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

  if (order.customerId) {
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
      if (order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_NOT_PAYABLE");

      const [bankAccount] = await tx
        .select()
        .from(paymentBankAccounts)
        .where(and(eq(paymentBankAccounts.id, input.bankAccountId), eq(paymentBankAccounts.enabled, true)))
        .limit(1);
      if (!bankAccount || bankAccount.provider !== "sepay") throw new Error("BANK_ACCOUNT_NOT_FOUND");

      const remaining = Math.max(0, Number(order.total) - Number(order.amountPaid));
      if (amount > remaining + 1e-9) throw new Error("AMOUNT_EXCEEDS_REMAINING");

      const reference = input.reference?.trim() || generatePaymentReference("LUMA");
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
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createPendingSepayPayment failed:", e);
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
    await db.update(payments).set({ status: "expired" }).where(and(eq(payments.id, paymentId), eq(payments.status, "pending")));
    return { ok: true, data: undefined };
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
      })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.provider, "sepay")))
      .limit(1);
    if (!payment) return { ok: false, error: "errors.invalidData" };
    return {
      ok: true,
      data: {
        ...payment,
        amount: Number(payment.amount),
      },
    };
  } catch (e) {
    console.error("getSepayPaymentStatus failed:", e);
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

export async function manualConfirmPaymentCore(
  db: DbLike,
  paymentId: string
): Promise<PaymentActionResult<{ alreadyConfirmed: boolean }>> {
  return confirmPaymentFromProvider(db, { paymentId, source: "manual" });
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

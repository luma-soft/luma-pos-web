"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cashTransactions } from "@/db/schema";
import { type ActionResult, requireManager, getProfileId, generateCode } from "./common";
import { Routes } from "@/lib/routes";
import { recordActivity } from "@/lib/audit/activity-log";
import { getCurrentShift } from "@/lib/data/shifts";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { reverseCashTransaction } from "@/lib/cashbook/reversals";
import { cancelCustomerReceivableForUser } from "@/lib/receivables/service";
import { cancelSupplierPayableForUser } from "@/lib/payables/service";

const schema = z.object({
  type: z.enum(["in", "out"]),
  fund: z.enum(["cash", "bank"]),
  amount: z.number().positive(),
  category: z.enum(["expense", "other", "debt_collect", "supplier_payment"]),
  counterparty: z.string().trim().max(200).optional().default(""),
  note: z.string().min(1, { error: "validation.required" }),
});

const cancelSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export type CreateCashTxInput = z.input<typeof schema>;

export async function createCashTx(input: CreateCashTxInput): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  return createCashTxForUser(gate.userId, input);
}

export async function createCashTxForUser(userId: string, input: CreateCashTxInput): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const context = await resolveStoreContextForUser(userId);
    if (!context) return { ok: false, error: "errors.unauthorized" };
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(context.storeId, profileId) : null;
    await db.transaction(async (tx) => {
      const [entry] = await tx.insert(cashTransactions).values({
        storeId: context.storeId,
        code: generateCode(v.type === "in" ? "PT" : "PC"),
        shiftId: currentShift?.id ?? null,
        type: v.type,
        fund: v.fund,
        amount: v.amount.toFixed(2),
        category: v.category,
        counterparty: v.counterparty || null,
        refType: "manual",
        note: v.note,
        createdBy: profileId,
      }).returning({ id: cashTransactions.id, code: cashTransactions.code });
      await recordActivity(tx, {
        storeId: context.storeId,
        actorId: profileId,
        action: "cash.transaction.created",
        entityType: "cash_transaction",
        entityId: entry.id,
        status: "succeeded",
        after: {
          code: entry.code,
          type: v.type,
          fund: v.fund,
          amount: v.amount,
          category: v.category,
          counterparty: v.counterparty,
          note: v.note,
        },
        metadata: { route: Routes.Cashbook },
      });
    });
    revalidatePath(Routes.Cashbook);
    revalidatePath(Routes.Notifications);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("createCashTx failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function cancelCashTx(input: z.input<typeof cancelSchema>): Promise<ActionResult<{ replayed: boolean }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  return cancelCashTransactionForUser(gate.userId, input);
}

export async function cancelCashTransactionForUser(
  userId: string,
  input: z.input<typeof cancelSchema>,
): Promise<ActionResult<{ replayed: boolean }>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const { transactionId, reason } = parsed.data;
  const context = await resolveStoreContextForUser(userId);
  if (!context) return { ok: false, error: "errors.unauthorized" };

  const [transaction] = await db.select().from(cashTransactions).where(and(
    eq(cashTransactions.storeId, context.storeId),
    eq(cashTransactions.id, transactionId),
  )).limit(1);
  if (!transaction) return { ok: false, error: "errors.notFound" };
  if (transaction.status === "cancelled") return { ok: true, data: { replayed: true } };

  if (transaction.refType === "customer_receivable_receipt" && transaction.refId) {
    const result = await cancelCustomerReceivableForUser(userId, { receiptId: transaction.refId, reason });
    return result.ok ? { ok: true, data: { replayed: result.data.replayed } } : result;
  }
  if (transaction.refType === "supplier_payable_receipt" && transaction.refId) {
    const result = await cancelSupplierPayableForUser(userId, { receiptId: transaction.refId, reason });
    return result.ok ? { ok: true, data: { replayed: result.data.replayed } } : result;
  }
  if (transaction.refType !== "manual") {
    return { ok: false, error: "financialVoucherCancellation.errors.useSource" };
  }

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(context.storeId, profileId) : null;
    let replayed = false;
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(cashTransactions).where(and(
        eq(cashTransactions.storeId, context.storeId),
        eq(cashTransactions.id, transactionId),
      )).limit(1).for("update");
      if (!locked) throw new Error("CASH_TRANSACTION_NOT_FOUND");
      if (locked.status === "cancelled") {
        replayed = true;
        return;
      }
      if (locked.refType !== "manual") throw new Error("CASH_TRANSACTION_NOT_CANCELLABLE");

      const reversed = await reverseCashTransaction(tx, {
        transaction: locked,
        actorId: profileId,
        shiftId: currentShift?.id ?? null,
        reason,
        referenceType: "cash_transaction_cancellation",
        referenceId: locked.id,
      });
      await recordActivity(tx, {
        storeId: context.storeId,
        actorId: profileId,
        action: "cash.transaction.cancelled",
        entityType: "cash_transaction",
        entityId: locked.id,
        before: { code: locked.code, status: "confirmed", type: locked.type, amount: Number(locked.amount) },
        after: { code: locked.code, status: "cancelled", reason, reversalCode: reversed.code },
        metadata: { route: Routes.Cashbook },
      });
    });
    revalidatePath(Routes.Cashbook);
    revalidatePath(Routes.Finance);
    revalidatePath(Routes.Notifications);
    return { ok: true, data: { replayed } };
  } catch (error) {
    console.error("cancelCashTx failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { db } from "@/db";
import { cashTransactions } from "@/db/schema";
import { type ActionResult, requireManager, getProfileId, generateCode } from "./common";
import { Routes } from "@/lib/routes";
import { recordActivity } from "@/lib/audit/activity-log";
import { getCurrentShift } from "@/lib/data/shifts";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";

const schema = z.object({
  type: z.enum(["in", "out"]),
  fund: z.enum(["cash", "bank"]),
  amount: z.number().positive(),
  category: z.enum(["expense", "other", "debt_collect", "supplier_payment"]),
  note: z.string().min(1, { error: "validation.required" }),
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

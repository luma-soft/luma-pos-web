"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { cashTransactions } from "@/db/schema";
import { type ActionResult, requireManager, getProfileId, generateCode } from "./common";
import { Routes } from "@/lib/routes";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentShift } from "@/lib/data/shifts";

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
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;
    await db.insert(cashTransactions).values({
      code: generateCode(v.type === "in" ? "PT" : "PC"),
      shiftId: currentShift?.id ?? null,
      type: v.type,
      fund: v.fund,
      amount: v.amount.toFixed(2),
      category: v.category,
      refType: "manual",
      note: v.note,
      createdBy: profileId,
    });
    await writeAuditLog({
      actorId: profileId,
      source: "manual",
      action: "create_cash_transaction",
      entityType: "cash_transaction",
      status: "succeeded",
      after: {
        type: v.type,
        fund: v.fund,
        amount: v.amount,
        category: v.category,
        note: v.note,
      },
      metadata: { route: Routes.Cashbook },
    });
    revalidatePath(Routes.Cashbook);
    revalidatePath(Routes.Notifications);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("createCashTx failed:", e);
    await writeAuditLog({
      actorUserId: userId,
      source: "manual",
      action: "create_cash_transaction",
      entityType: "cash_transaction",
      status: "failed",
      after: {
        type: v.type,
        fund: v.fund,
        amount: v.amount,
        category: v.category,
      },
      metadata: { error: e instanceof Error ? e.message : String(e) },
    });
    return { ok: false, error: "errors.serverError" };
  }
}

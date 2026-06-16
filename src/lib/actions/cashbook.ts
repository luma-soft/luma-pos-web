"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { cashTransactions } from "@/db/schema";
import { type ActionResult, requireManager, getProfileId, generateCode } from "./common";
import { Routes } from "@/lib/routes";

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
  const userId = gate.userId;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const profileId = await getProfileId(userId);
    await db.insert(cashTransactions).values({
      code: generateCode(v.type === "in" ? "PT" : "PC"),
      type: v.type,
      fund: v.fund,
      amount: v.amount.toFixed(2),
      category: v.category,
      refType: "manual",
      note: v.note,
      createdBy: profileId,
    });
    revalidatePath(Routes.Cashbook);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("createCashTx failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

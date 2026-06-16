"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { modifierGroups } from "@/db/schema";
import { modifierGroupSchema, type ModifierGroupInput } from "@/lib/schemas/table";
import { type ActionResult, requireUser, getRole } from "./common";

async function requireManager(): Promise<{ ok: true } | { ok: false; error: string }> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  const role = await getRole(userId);
  if (role !== "owner" && role !== "manager") return { ok: false, error: "errors.forbidden" };
  return { ok: true };
}

export async function saveModifierGroup(id: string | null, input: ModifierGroupInput): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = modifierGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    if (id) {
      await db.update(modifierGroups).set({
        name: v.name, multi: v.multi, required: v.required, options: v.options, categoryIds: v.categoryIds, sortOrder: v.sortOrder,
      }).where(eq(modifierGroups.id, id));
    } else {
      await db.insert(modifierGroups).values({
        name: v.name, multi: v.multi, required: v.required, options: v.options, categoryIds: v.categoryIds, sortOrder: v.sortOrder,
      });
    }
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("saveModifierGroup failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function setModifierGroupActive(id: string, isActive: boolean): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.update(modifierGroups).set({ isActive }).where(eq(modifierGroups.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("setModifierGroupActive failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function deleteModifierGroup(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.delete(modifierGroups).where(eq(modifierGroups.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("deleteModifierGroup failed:", e); return { ok: false, error: "errors.serverError" }; }
}

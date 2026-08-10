"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { modifierGroups } from "@/db/schema";
import { modifierGroupSchema, type ModifierGroupInput } from "@/lib/schemas/table";
import { type ActionResult, requireManager } from "./common";

export async function saveModifierGroup(id: string | null, input: ModifierGroupInput): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = modifierGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    if (id) {
      await db.update(modifierGroups).set({
        name: v.name, multi: v.multi, required: v.required, options: v.options, categoryIds: v.categoryIds, sortOrder: v.sortOrder,
      }).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id)));
    } else {
      await db.insert(modifierGroups).values({
        storeId: gate.storeId,
        name: v.name, multi: v.multi, required: v.required, options: v.options, categoryIds: v.categoryIds, sortOrder: v.sortOrder,
      });
    }
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("saveModifierGroup failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function setModifierGroupActive(id: string, isActive: boolean): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.update(modifierGroups).set({ isActive }).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id)));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("setModifierGroupActive failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function deleteModifierGroup(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.delete(modifierGroups).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id)));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("deleteModifierGroup failed:", e); return { ok: false, error: "errors.serverError" }; }
}

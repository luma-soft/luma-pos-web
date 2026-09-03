"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { modifierGroups } from "@/db/schema";
import { modifierGroupSchema, type ModifierGroupInput } from "@/lib/schemas/table";
import { type ActionResult, requireManager } from "./common";
import { recordActivity } from "@/lib/audit/activity-log";
import { activityValuesEqual } from "@/lib/products/product-activity";

export async function saveModifierGroup(id: string | null, input: ModifierGroupInput): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = modifierGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const after = { name: v.name, multi: v.multi, required: v.required, options: v.options, categoryIds: v.categoryIds, sortOrder: v.sortOrder };
      if (id) {
        const [before] = await tx.select({ name: modifierGroups.name, multi: modifierGroups.multi, required: modifierGroups.required, options: modifierGroups.options, categoryIds: modifierGroups.categoryIds, sortOrder: modifierGroups.sortOrder })
          .from(modifierGroups).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id))).limit(1).for("update");
        if (!before || activityValuesEqual(before, after)) return;
        await tx.update(modifierGroups).set(after).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id)));
        await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "modifier_group.updated", entityType: "modifier_group", entityId: id, before, after });
      } else {
        const [created] = await tx.insert(modifierGroups).values({
          storeId: gate.storeId,
          name: v.name, multi: v.multi, required: v.required, options: v.options, categoryIds: v.categoryIds, sortOrder: v.sortOrder,
        }).returning({ id: modifierGroups.id });
        await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "modifier_group.created", entityType: "modifier_group", entityId: created.id, after });
      }
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("saveModifierGroup failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function setModifierGroupActive(id: string, isActive: boolean): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select({ name: modifierGroups.name, isActive: modifierGroups.isActive }).from(modifierGroups)
        .where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id))).limit(1).for("update");
      if (!before || before.isActive === isActive) return;
      await tx.update(modifierGroups).set({ isActive }).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "modifier_group.status.changed", entityType: "modifier_group", entityId: id, before, after: { name: before.name, isActive } });
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("setModifierGroupActive failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function deleteModifierGroup(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.delete(modifierGroups).where(and(eq(modifierGroups.storeId, gate.storeId), eq(modifierGroups.id, id))).returning({ name: modifierGroups.name });
      if (before) await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "modifier_group.deleted", entityType: "modifier_group", entityId: id, before });
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("deleteModifierGroup failed:", e); return { ok: false, error: "errors.serverError" }; }
}

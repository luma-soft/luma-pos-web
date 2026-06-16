import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { modifierGroups } from "@/db/schema";

export type ModifierGroup = {
  id: string;
  name: string;
  multi: boolean;
  required: boolean;
  options: { id: string; label: string; priceDelta: number }[];
  categoryIds: string[];
  sortOrder: number;
  isActive: boolean;
};

function map(r: typeof modifierGroups.$inferSelect): ModifierGroup {
  return {
    id: r.id, name: r.name, multi: r.multi, required: r.required,
    options: r.options ?? [], categoryIds: r.categoryIds ?? [],
    sortOrder: r.sortOrder, isActive: r.isActive,
  };
}

/** Tất cả nhóm (cho màn quản lý). */
export async function getModifierGroups(): Promise<ModifierGroup[]> {
  const rows = await db.select().from(modifierGroups).orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.createdAt));
  return rows.map(map);
}

/** Chỉ nhóm đang bật (cho picker khi gọi món). */
export async function getActiveModifierGroups(): Promise<ModifierGroup[]> {
  const rows = await db.select().from(modifierGroups).where(eq(modifierGroups.isActive, true)).orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.createdAt));
  return rows.map(map);
}

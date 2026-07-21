import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables } from "@/db/schema";
import type { TableCartItem } from "@/lib/schemas/table";

export type { TableCartItem } from "@/lib/schemas/table";

/** Chuẩn hóa dòng giỏ cũ (trước khi có modifier/lineId) sang shape mới. */
function normalizeCart(raw: unknown): TableCartItem[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((r) => {
    const i = r as Record<string, unknown>;
    const unitPrice = Number(i.unitPrice) || 0;
    const course = ["asap", "starter", "main", "dessert", "drink"].includes(String(i.course))
      ? i.course as TableCartItem["course"]
      : "asap";
    return {
      lineId: typeof i.lineId === "string" ? i.lineId : `${i.productId}-${Math.random().toString(36).slice(2, 8)}`,
      productId: String(i.productId),
      productName: String(i.productName ?? ""),
      unitName: String(i.unitName ?? ""),
      unitMultiplier: Number(i.unitMultiplier) || 1,
      quantity: Number(i.quantity) || 0,
      basePrice: Number(i.basePrice) || unitPrice,
      unitPrice,
      modifiers: Array.isArray(i.modifiers) ? (i.modifiers as TableCartItem["modifiers"]) : [],
      note: typeof i.note === "string" ? i.note : undefined,
      course,
      courseDelayMinutes: Math.max(0, Math.min(240, Math.trunc(Number(i.courseDelayMinutes) || 0))),
      sent: i.sent === true,
    };
  });
}

function cartTotal(cart: TableCartItem[]): number {
  return cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
}

export async function getTables() {
  const rows = await db.select().from(diningTables).orderBy(asc(diningTables.zone), asc(diningTables.sortOrder), asc(diningTables.name));
  return rows.map((r) => {
    const cart = normalizeCart(r.currentCart);
    return {
      id: r.id, name: r.name, zone: r.zone, status: r.status, openedAt: r.openedAt,
      itemCount: cart.reduce((s, i) => s + i.quantity, 0),
      total: cartTotal(cart),
    };
  });
}
export type TableRow = Awaited<ReturnType<typeof getTables>>[number];

export async function getTable(id: string) {
  const [r] = await db.select().from(diningTables).where(eq(diningTables.id, id)).limit(1);
  if (!r) return null;
  return { id: r.id, name: r.name, zone: r.zone, status: r.status, openedAt: r.openedAt, cart: normalizeCart(r.currentCart) };
}

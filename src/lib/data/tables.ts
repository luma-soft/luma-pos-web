import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables } from "@/db/schema";

export type TableCartItem = { productId: string; productName: string; unitName: string; unitMultiplier: number; quantity: number; unitPrice: number };

function cartTotal(cart: TableCartItem[]): number {
  return cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
}

export async function getTables() {
  const rows = await db.select().from(diningTables).orderBy(asc(diningTables.zone), asc(diningTables.sortOrder), asc(diningTables.name));
  return rows.map((r) => {
    const cart = (r.currentCart ?? []) as TableCartItem[];
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
  return { id: r.id, name: r.name, zone: r.zone, status: r.status, openedAt: r.openedAt, cart: (r.currentCart ?? []) as TableCartItem[] };
}

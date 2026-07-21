import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { kitchenTickets, kitchenTicketItems } from "@/db/schema";

export type KdsItemStatus = "pending" | "preparing" | "ready" | "served";

export type KdsItem = {
  id: string;
  productName: string;
  quantity: number;
  modifiers: { label: string; priceDelta: number }[];
  note: string | null;
  course: string;
  fireAt: Date | null;
  status: KdsItemStatus;
};

export type KdsTicket = {
  id: string;
  tableName: string;
  round: number;
  createdAt: Date;
  items: KdsItem[];
};

/** Phiếu bếp đang hoạt động (còn món chưa phục vụ), kèm món, theo thứ tự cũ → mới. */
export async function getActiveTickets(): Promise<KdsTicket[]> {
  const tickets = await db
    .select()
    .from(kitchenTickets)
    .where(eq(kitchenTickets.status, "active"))
    .orderBy(asc(kitchenTickets.createdAt));
  if (tickets.length === 0) return [];

  const ids = tickets.map((t) => t.id);
  const items = await db
    .select()
    .from(kitchenTicketItems)
    .where(and(inArray(kitchenTicketItems.ticketId, ids), ne(kitchenTicketItems.status, "served")))
    .orderBy(asc(kitchenTicketItems.createdAt));

  const byTicket = new Map<string, KdsItem[]>();
  for (const it of items) {
    const list = byTicket.get(it.ticketId) ?? [];
    list.push({
      id: it.id,
      productName: it.productName,
      quantity: Number(it.quantity),
      modifiers: it.modifiers ?? [],
      note: it.note,
      course: it.course,
      fireAt: it.fireAt,
      status: it.status as KdsItemStatus,
    });
    byTicket.set(it.ticketId, list);
  }

  return tickets
    .map((t) => ({ id: t.id, tableName: t.tableName, round: t.round, createdAt: t.createdAt, items: byTicket.get(t.id) ?? [] }))
    .filter((t) => t.items.length > 0);
}

"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { kitchenTickets, kitchenTicketItems } from "@/db/schema";
import { type ActionResult } from "./common";
import { requireStoreContext } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

const STATUSES = ["pending", "preparing", "ready", "served"] as const;
type ItemStatus = (typeof STATUSES)[number];

async function closeTicketIfDone(tx: Pick<typeof db, "select" | "update">, storeId: string, ticketId: string) {
  const [left] = await tx
    .select({ id: kitchenTicketItems.id })
    .from(kitchenTicketItems)
    .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.ticketId, ticketId), ne(kitchenTicketItems.status, "served")))
    .limit(1);
  if (!left) await tx.update(kitchenTickets).set({ status: "done" }).where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.id, ticketId)));
}

export async function setTicketItemStatus(itemId: string, status: ItemStatus): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return setTicketItemStatusForUser(context.storeId, itemId, status, context.userId);
}

export async function setTicketItemStatusForUser(storeId: string, itemId: string, status: ItemStatus, actorId: string): Promise<ActionResult> {
  if (!STATUSES.includes(status)) return { ok: false, error: "errors.invalidData" };
  try {
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      const [item] = await tx.select().from(kitchenTicketItems)
        .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.id, itemId))).limit(1);
      if (!item) return { ok: false, error: "errors.invalidData" };
      const [ticket] = await tx.select().from(kitchenTickets)
        .where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.id, item.ticketId))).limit(1).for("update");
      const [scheduled] = await tx.select().from(kitchenTicketItems)
        .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.id, itemId))).limit(1).for("update");
      if (!scheduled || !ticket) return { ok: false, error: "errors.invalidData" };
      if (status !== "pending" && scheduled.fireAt && scheduled.fireAt.getTime() > Date.now()) {
        return { ok: false, error: "tables.errors.courseNotFired" };
      }
      if (scheduled.status === status) return { ok: true, data: undefined };
      await tx.update(kitchenTicketItems).set({ status, updatedAt: new Date() })
        .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.id, itemId)));
      if (status === "served") await closeTicketIfDone(tx, storeId, scheduled.ticketId);
      await recordActivity(tx, {
        storeId, actorId, action: "kitchen.item.updated", entityType: "table", entityId: ticket.tableId,
        before: { name: ticket.tableName, productName: scheduled.productName, status: scheduled.status },
        after: { name: ticket.tableName, productName: scheduled.productName, status, quantity: Number(scheduled.quantity), round: ticket.round },
        affectedRecords: [{ type: "table", id: ticket.tableId, name: ticket.tableName }, { type: "kitchen_ticket", id: ticket.id }],
      });
      return { ok: true, data: undefined };
    });
    if (!result.ok) return result;
    revalidatePath("/kds"); return { ok: true, data: undefined };
  } catch (e) { console.error("setTicketItemStatus failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Phục vụ cả phiếu (mọi món → served, phiếu → done). */
export async function serveTicket(ticketId: string): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return serveTicketForUser(context.storeId, ticketId, context.userId);
}

export async function serveTicketForUser(storeId: string, ticketId: string, actorId: string): Promise<ActionResult> {
  try {
    await db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(kitchenTickets)
        .where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.id, ticketId))).limit(1).for("update");
      if (!ticket) return;
      const changed = await tx.update(kitchenTicketItems).set({ status: "served", updatedAt: new Date() })
        .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.ticketId, ticketId), ne(kitchenTicketItems.status, "served")))
        .returning({ productName: kitchenTicketItems.productName, quantity: kitchenTicketItems.quantity });
      if (ticket.status === "done" && changed.length === 0) return;
      await tx.update(kitchenTickets).set({ status: "done" }).where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.id, ticketId)));
      await recordActivity(tx, {
        storeId, actorId, action: "kitchen.served", entityType: "table", entityId: ticket.tableId,
        before: { name: ticket.tableName, status: ticket.status },
        after: { name: ticket.tableName, status: "done", round: ticket.round, items: changed.map((item) => ({ productName: item.productName, quantity: Number(item.quantity) })) },
        affectedRecords: [{ type: "table", id: ticket.tableId, name: ticket.tableName }, { type: "kitchen_ticket", id: ticket.id }],
      });
    });
    revalidatePath("/kds"); return { ok: true, data: undefined };
  } catch (e) { console.error("serveTicket failed:", e); return { ok: false, error: "errors.serverError" }; }
}

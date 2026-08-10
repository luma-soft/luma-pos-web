"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { kitchenTickets, kitchenTicketItems } from "@/db/schema";
import { type ActionResult } from "./common";
import { requireStoreContext } from "@/lib/auth/store-context";

const STATUSES = ["pending", "preparing", "ready", "served"] as const;
type ItemStatus = (typeof STATUSES)[number];

async function closeTicketIfDone(storeId: string, ticketId: string) {
  const [left] = await db
    .select({ id: kitchenTicketItems.id })
    .from(kitchenTicketItems)
    .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.ticketId, ticketId), ne(kitchenTicketItems.status, "served")))
    .limit(1);
  if (!left) await db.update(kitchenTickets).set({ status: "done" }).where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.id, ticketId)));
}

export async function setTicketItemStatus(itemId: string, status: ItemStatus): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return setTicketItemStatusForUser(context.storeId, itemId, status);
}

export async function setTicketItemStatusForUser(storeId: string, itemId: string, status: ItemStatus): Promise<ActionResult> {
  if (!STATUSES.includes(status)) return { ok: false, error: "errors.invalidData" };
  try {
    const [scheduled] = await db.select({ fireAt: kitchenTicketItems.fireAt })
      .from(kitchenTicketItems)
      .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.id, itemId)))
      .limit(1);
    if (!scheduled) return { ok: false, error: "errors.invalidData" };
    if (status !== "pending" && scheduled.fireAt && scheduled.fireAt.getTime() > Date.now()) {
      return { ok: false, error: "tables.errors.courseNotFired" };
    }
    const [it] = await db.update(kitchenTicketItems).set({ status, updatedAt: new Date() })
      .where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.id, itemId))).returning({ ticketId: kitchenTicketItems.ticketId });
    if (it && status === "served") await closeTicketIfDone(storeId, it.ticketId);
    revalidatePath("/kds"); return { ok: true, data: undefined };
  } catch (e) { console.error("setTicketItemStatus failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Phục vụ cả phiếu (mọi món → served, phiếu → done). */
export async function serveTicket(ticketId: string): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return serveTicketForUser(context.storeId, ticketId);
}

export async function serveTicketForUser(storeId: string, ticketId: string): Promise<ActionResult> {
  try {
    await db.update(kitchenTicketItems).set({ status: "served", updatedAt: new Date() }).where(and(eq(kitchenTicketItems.storeId, storeId), eq(kitchenTicketItems.ticketId, ticketId)));
    await db.update(kitchenTickets).set({ status: "done" }).where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.id, ticketId)));
    revalidatePath("/kds"); return { ok: true, data: undefined };
  } catch (e) { console.error("serveTicket failed:", e); return { ok: false, error: "errors.serverError" }; }
}

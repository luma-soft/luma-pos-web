"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { kitchenTickets, kitchenTicketItems } from "@/db/schema";
import { type ActionResult, requireUser } from "./common";

const STATUSES = ["pending", "preparing", "ready", "served"] as const;
type ItemStatus = (typeof STATUSES)[number];

async function closeTicketIfDone(ticketId: string) {
  const [left] = await db
    .select({ id: kitchenTicketItems.id })
    .from(kitchenTicketItems)
    .where(and(eq(kitchenTicketItems.ticketId, ticketId), ne(kitchenTicketItems.status, "served")))
    .limit(1);
  if (!left) await db.update(kitchenTickets).set({ status: "done" }).where(eq(kitchenTickets.id, ticketId));
}

export async function setTicketItemStatus(itemId: string, status: ItemStatus): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return setTicketItemStatusForUser(itemId, status);
}

export async function setTicketItemStatusForUser(itemId: string, status: ItemStatus): Promise<ActionResult> {
  if (!STATUSES.includes(status)) return { ok: false, error: "errors.invalidData" };
  try {
    const [scheduled] = await db.select({ fireAt: kitchenTicketItems.fireAt })
      .from(kitchenTicketItems)
      .where(eq(kitchenTicketItems.id, itemId))
      .limit(1);
    if (!scheduled) return { ok: false, error: "errors.invalidData" };
    if (status !== "pending" && scheduled.fireAt && scheduled.fireAt.getTime() > Date.now()) {
      return { ok: false, error: "tables.errors.courseNotFired" };
    }
    const [it] = await db.update(kitchenTicketItems).set({ status, updatedAt: new Date() })
      .where(eq(kitchenTicketItems.id, itemId)).returning({ ticketId: kitchenTicketItems.ticketId });
    if (it && status === "served") await closeTicketIfDone(it.ticketId);
    revalidatePath("/kds"); return { ok: true, data: undefined };
  } catch (e) { console.error("setTicketItemStatus failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Phục vụ cả phiếu (mọi món → served, phiếu → done). */
export async function serveTicket(ticketId: string): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return serveTicketForUser(ticketId);
}

export async function serveTicketForUser(ticketId: string): Promise<ActionResult> {
  try {
    await db.update(kitchenTicketItems).set({ status: "served", updatedAt: new Date() }).where(eq(kitchenTicketItems.ticketId, ticketId));
    await db.update(kitchenTickets).set({ status: "done" }).where(eq(kitchenTickets.id, ticketId));
    revalidatePath("/kds"); return { ok: true, data: undefined };
  } catch (e) { console.error("serveTicket failed:", e); return { ok: false, error: "errors.serverError" }; }
}

"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { diningTables, warehouses, kitchenTickets, kitchenTicketItems } from "@/db/schema";
import { tableCartSchema, type TableCartItem } from "@/lib/schemas/table";
import { createOrderForUser } from "@/lib/orders/create";
import { type ActionResult, requireUser, requireManager, getProfileId, toQty } from "./common";

type Method = "cash" | "bank_transfer" | "credit";

function readCart(raw: unknown): TableCartItem[] {
  const parsed = tableCartSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Đóng các phiếu bếp đang mở của 1 bàn (khi thanh toán xong / đóng bàn). */
async function closeTickets(tableId: string) {
  await db.update(kitchenTickets).set({ status: "done" }).where(and(eq(kitchenTickets.tableId, tableId), eq(kitchenTickets.status, "active")));
}

export async function createTable(name: string, zone: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!name.trim()) return { ok: false, error: "errors.invalidData" };
  try {
    await db.insert(diningTables).values({ name: name.trim(), zone: zone.trim() });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("createTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function renameTable(id: string, name: string, zone: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.update(diningTables).set({ name: name.trim(), zone: zone.trim() }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("renameTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function deleteTable(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    const [t] = await db.select({ status: diningTables.status }).from(diningTables).where(eq(diningTables.id, id)).limit(1);
    if (t?.status === "occupied") return { ok: false, error: "tables.errors.occupied" };
    await db.delete(diningTables).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("deleteTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function openTable(id: string): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    await db.update(diningTables).set({ status: "occupied", openedAt: new Date() }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("openTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function setTableCart(id: string, items: unknown): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  const parsed = tableCartSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    await db.update(diningTables).set({ currentCart: parsed.data, status: "occupied" }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("setTableCart failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function closeTable(id: string): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    await closeTickets(id);
    await db.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("closeTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Gửi bếp: tạo phiếu từ các dòng chưa gửi, đánh dấu sent. */
export async function sendToKitchen(id: string): Promise<ActionResult<{ ticketId: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    const [t] = await db.select().from(diningTables).where(eq(diningTables.id, id)).limit(1);
    if (!t) return { ok: false, error: "errors.invalidData" };
    const cart = readCart(t.currentCart);
    const fresh = cart.filter((i) => !i.sent);
    if (fresh.length === 0) return { ok: false, error: "tables.errors.nothingToSend" };

    const profileId = await getProfileId(userId);
    const [{ round }] = await db.select({ round: kitchenTickets.round }).from(kitchenTickets)
      .where(eq(kitchenTickets.tableId, id)).orderBy(desc(kitchenTickets.round)).limit(1)
      .then((r) => (r.length ? r : [{ round: 0 }]));

    const ticketId = await db.transaction(async (tx) => {
      const [ticket] = await tx.insert(kitchenTickets).values({
        tableId: id, tableName: t.name, round: round + 1, createdBy: profileId,
      }).returning({ id: kitchenTickets.id });
      await tx.insert(kitchenTicketItems).values(fresh.map((i) => ({
        ticketId: ticket.id, productId: i.productId, productName: i.productName,
        quantity: toQty(i.quantity), modifiers: i.modifiers, note: i.note ?? null,
      })));
      return ticket.id;
    });

    const next = cart.map((i) => (i.sent ? i : { ...i, sent: true }));
    await db.update(diningTables).set({ currentCart: next }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); revalidatePath("/kds");
    return { ok: true, data: { ticketId } };
  } catch (e) { console.error("sendToKitchen failed:", e); return { ok: false, error: "errors.serverError" }; }
}

const lineIdsSchema = z.array(z.string()).optional();

/** Thanh toán bàn — nếu truyền lineIds thì chỉ thanh toán phần đã chọn (tách bill). */
export async function checkoutTable(id: string, method: Method, lineIds?: unknown): Promise<ActionResult<{ code: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  const ids = lineIdsSchema.safeParse(lineIds);
  if (!ids.success) return { ok: false, error: "errors.invalidData" };
  try {
    const [t] = await db.select().from(diningTables).where(eq(diningTables.id, id)).limit(1);
    if (!t) return { ok: false, error: "errors.invalidData" };
    const cart = readCart(t.currentCart);
    if (cart.length === 0) return { ok: false, error: "pos.errors.emptyCart" };

    const selected = ids.data && ids.data.length > 0 ? cart.filter((i) => ids.data!.includes(i.lineId)) : cart;
    if (selected.length === 0) return { ok: false, error: "pos.errors.emptyCart" };

    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(desc(warehouses.isDefault)).limit(1);
    if (!wh) return { ok: false, error: "errors.invalidData" };
    const total = selected.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    const res = await createOrderForUser(userId, {
      mode: "sale",
      warehouseId: wh.id,
      items: selected.map((i) => ({
        productId: i.productId,
        productName: i.modifiers.length ? `${i.productName} (${i.modifiers.map((m) => m.label).join(", ")})` : i.productName,
        unitName: i.unitName,
        unitMultiplier: i.unitMultiplier,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      discount: 0,
      shippingFee: 0,
      note: `Bàn ${t.name}`,
      payment: { method, amount: total },
    });
    if (!res.ok) return res;

    const remaining = cart.filter((i) => !selected.some((s) => s.lineId === i.lineId));
    if (remaining.length === 0) {
      await closeTickets(id);
      await db.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(eq(diningTables.id, id));
    } else {
      await db.update(diningTables).set({ currentCart: remaining }).where(eq(diningTables.id, id));
    }
    revalidatePath("/tables");
    return { ok: true, data: { code: res.data.code } };
  } catch (e) { console.error("checkoutTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Gộp bàn: dồn giỏ + phiếu bếp của các bàn nguồn về bàn đích, giải phóng bàn nguồn. */
export async function mergeTables(targetId: string, sourceIds: unknown): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  const parsed = z.array(z.uuid()).min(1).safeParse(sourceIds);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const sources = parsed.data.filter((s) => s !== targetId);
  if (sources.length === 0) return { ok: false, error: "errors.invalidData" };
  try {
    const rows = await db.select().from(diningTables).where(inArray(diningTables.id, [targetId, ...sources]));
    const target = rows.find((r) => r.id === targetId);
    if (!target) return { ok: false, error: "errors.invalidData" };
    const merged = [...readCart(target.currentCart)];
    for (const s of sources) merged.push(...readCart(rows.find((r) => r.id === s)?.currentCart));

    await db.transaction(async (tx) => {
      await tx.update(diningTables).set({ currentCart: merged, status: "occupied", openedAt: target.openedAt ?? new Date() }).where(eq(diningTables.id, targetId));
      await tx.update(kitchenTickets).set({ tableId: targetId, tableName: target.name }).where(and(inArray(kitchenTickets.tableId, sources), eq(kitchenTickets.status, "active")));
      await tx.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(inArray(diningTables.id, sources));
    });
    revalidatePath("/tables"); revalidatePath("/kds");
    return { ok: true, data: undefined };
  } catch (e) { console.error("mergeTables failed:", e); return { ok: false, error: "errors.serverError" }; }
}

"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { diningTables, warehouses } from "@/db/schema";
import { orderItemSchema } from "@/lib/schemas/order";
import { createOrderForUser } from "@/lib/orders/create";
import { type ActionResult, requireUser, getRole } from "./common";

const cartSchema = z.array(orderItemSchema);
type Method = "cash" | "bank_transfer" | "credit";

async function requireManager(): Promise<{ ok: true } | { ok: false; error: string }> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  const role = await getRole(userId);
  if (role !== "owner" && role !== "manager") return { ok: false, error: "errors.forbidden" };
  return { ok: true };
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
    await db.update(diningTables).set({ status: "occupied", openedAt: new Date() })
      .where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("openTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function setTableCart(id: string, items: unknown): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  const parsed = cartSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    await db.update(diningTables).set({ currentCart: parsed.data, status: "occupied" }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("setTableCart failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function closeTable(id: string): Promise<ActionResult> {
  try { await requireUser(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    await db.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(eq(diningTables.id, id));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("closeTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function checkoutTable(id: string, method: Method): Promise<ActionResult<{ code: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    const [t] = await db.select().from(diningTables).where(eq(diningTables.id, id)).limit(1);
    if (!t) return { ok: false, error: "errors.invalidData" };
    const cart = cartSchema.safeParse(t.currentCart);
    if (!cart.success || cart.data.length === 0) return { ok: false, error: "pos.errors.emptyCart" };
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(desc(warehouses.isDefault)).limit(1);
    if (!wh) return { ok: false, error: "errors.invalidData" };
    const total = cart.data.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    const res = await createOrderForUser(userId, {
      mode: "sale",
      warehouseId: wh.id,
      items: cart.data,
      discount: 0,
      shippingFee: 0,
      note: `Bàn ${t.name}`,
      payment: { method, amount: total },
    });
    if (!res.ok) return res;
    await db.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(eq(diningTables.id, id));
    revalidatePath("/tables");
    return { ok: true, data: { code: res.data.code } };
  } catch (e) { console.error("checkoutTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

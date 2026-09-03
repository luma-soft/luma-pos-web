"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  diningTables,
  warehouses,
  kitchenTickets,
  kitchenTicketItems,
  modifierGroups,
  products,
  orders,
} from "@/db/schema";
import { tableCartSchema, type TableCartItem } from "@/lib/schemas/table";
import { createOrderForUser } from "@/lib/orders/create";
import {
  mergeLockedTableCart,
  resolveAuthoritativeTableCart,
  tableCheckoutClientId,
} from "@/lib/tables/authoritative-cart";
import { type ActionResult, requireUser, requireManager, getProfileId, toQty } from "./common";
import { requireStoreContext, resolveStoreContextForUser } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

type Method = "cash" | "bank_transfer" | "credit";

function readCart(raw: unknown): TableCartItem[] {
  const parsed = tableCartSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

const tableCartDataErrors = new Set([
  "PRODUCT_NOT_SELLABLE",
  "INVALID_PRODUCT_PRICE",
  "INVALID_MODIFIER_PRICE",
  "DUPLICATE_LINE_ID",
]);

function isTableCartDataError(error: unknown) {
  return error instanceof Error && tableCartDataErrors.has(error.message);
}

async function authoritativeTableCart(
  storeId: string,
  items: TableCartItem[],
  lockedSentLineIds: ReadonlySet<string>,
) {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const [productRows, modifierRows] = await Promise.all([
    productIds.length
      ? db
          .select({
            id: products.id,
            name: products.name,
            baseUnit: products.baseUnit,
            retailPrice: products.retailPrice,
            isActive: products.isActive,
            lifecycleStatus: products.lifecycleStatus,
            categoryId: products.categoryId,
          })
          .from(products)
          .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
      : Promise.resolve([]),
    db
      .select({
        options: modifierGroups.options,
        categoryIds: modifierGroups.categoryIds,
      })
      .from(modifierGroups)
      .where(and(eq(modifierGroups.storeId, storeId), eq(modifierGroups.isActive, true))),
  ]);
  return resolveAuthoritativeTableCart({
    items,
    products: productRows,
    modifierOptions: modifierRows.flatMap((group) =>
      (group.options ?? []).map((option) => ({
        label: option.label,
        priceDelta: option.priceDelta,
        categoryIds: group.categoryIds ?? [],
      })),
    ),
    lockedSentLineIds,
  });
}

/** Đóng các phiếu bếp đang mở của 1 bàn (khi thanh toán xong / đóng bàn). */
async function closeTickets(database: Pick<typeof db, "update">, storeId: string, tableId: string) {
  await database.update(kitchenTickets).set({ status: "done" }).where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.tableId, tableId), eq(kitchenTickets.status, "active")));
}

export async function createTable(name: string, zone: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!name.trim()) return { ok: false, error: "errors.invalidData" };
  try {
    await db.transaction(async (tx) => {
      const [table] = await tx.insert(diningTables).values({ storeId: gate.storeId, name: name.trim(), zone: zone.trim() }).returning();
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "table.created", entityType: "table", entityId: table.id,
        after: { name: table.name, zone: table.zone, status: table.status },
      });
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("createTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function renameTable(id: string, name: string, zone: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [table] = await tx.select().from(diningTables).where(and(eq(diningTables.storeId, gate.storeId), eq(diningTables.id, id))).limit(1).for("update");
      if (!table || (table.name === name.trim() && table.zone === zone.trim())) return;
      await tx.update(diningTables).set({ name: name.trim(), zone: zone.trim() }).where(and(eq(diningTables.storeId, gate.storeId), eq(diningTables.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "table.updated", entityType: "table", entityId: id,
        before: { name: table.name, zone: table.zone }, after: { name: name.trim(), zone: zone.trim() },
      });
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("renameTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function deleteTable(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    const deleted = await db.transaction(async (tx) => {
      const [t] = await tx.select().from(diningTables).where(and(eq(diningTables.storeId, gate.storeId), eq(diningTables.id, id))).limit(1).for("update");
      if (t?.status === "occupied") return false;
      if (!t) return true;
      await tx.delete(diningTables).where(and(eq(diningTables.storeId, gate.storeId), eq(diningTables.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "table.deleted", entityType: "table", entityId: id,
        before: { name: t.name, zone: t.zone, status: t.status },
      });
      return true;
    });
    if (!deleted) return { ok: false, error: "tables.errors.occupied" };
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("deleteTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function openTable(id: string): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    await db.transaction(async (tx) => {
      const [table] = await tx.select().from(diningTables).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id))).limit(1).for("update");
      if (!table || table.status === "occupied") return;
      await tx.update(diningTables).set({ status: "occupied", openedAt: new Date() }).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id)));
      await recordActivity(tx, {
        storeId: context.storeId, actorId: context.userId, action: "table.opened", entityType: "table", entityId: id,
        before: { name: table.name, status: table.status }, after: { name: table.name, status: "occupied" },
      });
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("openTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export async function setTableCart(id: string, items: unknown): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return setTableCartForUser(context.storeId, id, items);
}

export async function setTableCartForUser(storeId: string, id: string, items: unknown): Promise<ActionResult> {
  const parsed = tableCartSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    const [table] = await db
      .select({ currentCart: diningTables.currentCart })
      .from(diningTables)
      .where(and(eq(diningTables.storeId, storeId), eq(diningTables.id, id)))
      .limit(1);
    if (!table) return { ok: false, error: "errors.invalidData" };
    const merged = mergeLockedTableCart({
      existing: readCart(table.currentCart),
      requested: parsed.data,
    });
    const cart = await authoritativeTableCart(
      storeId,
      merged.items,
      merged.lockedSentLineIds,
    );
    await db.update(diningTables).set({ currentCart: cart, status: "occupied" }).where(and(eq(diningTables.storeId, storeId), eq(diningTables.id, id)));
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) {
    if (isTableCartDataError(e)) return { ok: false, error: "errors.invalidData" };
    console.error("setTableCart failed:", e); return { ok: false, error: "errors.serverError" };
  }
}

export async function closeTable(id: string): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  try {
    await db.transaction(async (tx) => {
      const [table] = await tx.select().from(diningTables).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id))).limit(1).for("update");
      if (!table || (table.status === "free" && readCart(table.currentCart).length === 0)) return;
      await closeTickets(tx, context.storeId, id);
      await tx.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id)));
      await recordActivity(tx, {
        storeId: context.storeId, actorId: context.userId, action: "table.closed", entityType: "table", entityId: id,
        before: { name: table.name, status: table.status, items: readCart(table.currentCart) }, after: { name: table.name, status: "free" },
      });
    });
    revalidatePath("/tables"); return { ok: true, data: undefined };
  } catch (e) { console.error("closeTable failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Gửi bếp: tạo phiếu từ các dòng chưa gửi, đánh dấu sent. */
export async function sendToKitchen(id: string): Promise<ActionResult<{ ticketId: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  return sendToKitchenForUser(userId, id);
}

export async function sendToKitchenForUser(userId: string, id: string): Promise<ActionResult<{ ticketId: string }>> {
  try {
    const context = await resolveStoreContextForUser(userId);
    if (!context) return { ok: false, error: "errors.unauthorized" };
    const profileId = await getProfileId(userId);
    const ticketId = await db.transaction(async (tx) => {
      const [t] = await tx.select().from(diningTables).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id))).limit(1).for("update");
      if (!t) throw new Error("TABLE_NOT_FOUND");
      const cart = readCart(t.currentCart);
      const fresh = cart.filter((i) => !i.sent);
      if (fresh.length === 0) throw new Error("NOTHING_TO_SEND");
      const [lastTicket] = await tx.select({ round: kitchenTickets.round }).from(kitchenTickets)
        .where(and(eq(kitchenTickets.storeId, context.storeId), eq(kitchenTickets.tableId, id))).orderBy(desc(kitchenTickets.round)).limit(1);
      const round = lastTicket?.round ?? 0;
      const [ticket] = await tx.insert(kitchenTickets).values({
        storeId: context.storeId,
        tableId: id, tableName: t.name, round: round + 1, createdBy: profileId,
      }).returning({ id: kitchenTickets.id });
      await tx.insert(kitchenTicketItems).values(fresh.map((i) => ({
        storeId: context.storeId,
        ticketId: ticket.id, productId: i.productId, productName: i.productName,
        quantity: toQty(i.quantity), modifiers: i.modifiers, note: i.note ?? null,
        course: i.course,
        fireAt: new Date(Date.now() + i.courseDelayMinutes * 60_000),
      })));
      const next = cart.map((i) => (i.sent ? i : { ...i, sent: true }));
      await tx.update(diningTables).set({ currentCart: next }).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id)));
      await recordActivity(tx, {
        storeId: context.storeId, actorId: profileId, action: "kitchen.sent", entityType: "table", entityId: id,
        after: { name: t.name, round: round + 1, items: fresh.map((item) => ({ productName: item.productName, quantity: item.quantity, note: item.note })) },
        affectedRecords: [{ type: "table", id, name: t.name }, { type: "kitchen_ticket", id: ticket.id, name: t.name }],
      });
      return ticket.id;
    });
    revalidatePath("/tables"); revalidatePath("/kds");
    return { ok: true, data: { ticketId } };
  } catch (e) {
    if (e instanceof Error && e.message === "NOTHING_TO_SEND") return { ok: false, error: "tables.errors.nothingToSend" };
    if (e instanceof Error && e.message === "TABLE_NOT_FOUND") return { ok: false, error: "errors.invalidData" };
    console.error("sendToKitchen failed:", e); return { ok: false, error: "errors.serverError" };
  }
}

const lineIdsSchema = z.array(z.string()).optional();

/** Thanh toán bàn — nếu truyền lineIds thì chỉ thanh toán phần đã chọn (tách bill). */
export async function checkoutTable(id: string, method: Method, lineIds?: unknown): Promise<ActionResult<{ code: string }>> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  return checkoutTableForUser(userId, id, method, lineIds);
}

export async function checkoutTableForUser(userId: string, id: string, method: Method, lineIds?: unknown): Promise<ActionResult<{ code: string }>> {
  const ids = lineIdsSchema.safeParse(lineIds);
  if (!ids.success) return { ok: false, error: "errors.invalidData" };
  try {
    const context = await resolveStoreContextForUser(userId);
    if (!context) return { ok: false, error: "errors.unauthorized" };
    const [t] = await db.select().from(diningTables).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id))).limit(1);
    if (!t) return { ok: false, error: "errors.invalidData" };
    const cart = readCart(t.currentCart);
    if (cart.length === 0) return { ok: false, error: "pos.errors.emptyCart" };

    const selectedRaw = ids.data && ids.data.length > 0 ? cart.filter((i) => ids.data!.includes(i.lineId)) : cart;
    if (selectedRaw.length === 0) return { ok: false, error: "pos.errors.emptyCart" };
    const selected = await authoritativeTableCart(
      context.storeId,
      selectedRaw,
      new Set(selectedRaw.filter((item) => item.sent).map((item) => item.lineId)),
    );

    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.storeId, context.storeId)).orderBy(desc(warehouses.isDefault)).limit(1);
    if (!wh) return { ok: false, error: "errors.invalidData" };
    const total = selected.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    const res = await createOrderForUser(userId, {
      mode: "sale",
      clientId: tableCheckoutClientId({
        tableId: id,
        lineIds: selected.map((item) => item.lineId),
      }),
      warehouseId: wh.id,
      items: selected.map((i) => ({
        productId: i.productId,
        productName: i.modifiers.length ? `${i.productName} (${i.modifiers.map((m) => m.label).join(", ")})` : i.productName,
        unitName: i.unitName,
        unitMultiplier: i.unitMultiplier,
        quantity: i.quantity,
        manualUnitPrice: i.unitPrice,
      })),
      discount: 0,
      shippingFee: 0,
      note: `Bàn ${t.name}`,
      payment: { method, amount: total },
    });
    if (!res.ok) return res;

    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(diningTables).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id))).limit(1).for("update");
      if (!current) return;
      const currentCart = readCart(current.currentCart);
      const remaining = currentCart.filter((item) => !selected.some((paid) => paid.lineId === item.lineId));
      if (remaining.length === currentCart.length) return;
      const [paidOrder] = await tx.select({ total: orders.total, amountPaid: orders.amountPaid, paymentStatus: orders.paymentStatus }).from(orders)
        .where(and(eq(orders.storeId, context.storeId), eq(orders.id, res.data.id))).limit(1);
      if (remaining.length === 0) {
        await closeTickets(tx, context.storeId, id);
        await tx.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id)));
      } else {
        await tx.update(diningTables).set({ currentCart: remaining }).where(and(eq(diningTables.storeId, context.storeId), eq(diningTables.id, id)));
      }
      await recordActivity(tx, {
        storeId: context.storeId, actorId: userId, action: "table.checked_out", entityType: "order", entityId: res.data.id,
        after: { code: res.data.code, tableName: current.name, total: Number(paidOrder?.total ?? total), amountPaid: Number(paidOrder?.amountPaid ?? 0), paymentStatus: paidOrder?.paymentStatus, method, itemCount: selected.length, remainingItemCount: remaining.length },
        affectedRecords: [{ type: "order", id: res.data.id, code: res.data.code }, { type: "table", id, name: current.name }],
      });
    });
    revalidatePath("/tables");
    return { ok: true, data: { code: res.data.code } };
  } catch (e) {
    if (isTableCartDataError(e)) return { ok: false, error: "errors.invalidData" };
    console.error("checkoutTable failed:", e); return { ok: false, error: "errors.serverError" };
  }
}

/** Gộp bàn: dồn giỏ + phiếu bếp của các bàn nguồn về bàn đích, giải phóng bàn nguồn. */
export async function mergeTables(targetId: string, sourceIds: unknown): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return mergeTablesForUser(context.storeId, targetId, sourceIds, context.userId);
}

export async function mergeTablesForUser(storeId: string, targetId: string, sourceIds: unknown, actorId: string): Promise<ActionResult> {
  const parsed = z.array(z.uuid()).min(1).safeParse(sourceIds);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const sources = parsed.data.filter((s) => s !== targetId);
  if (sources.length === 0) return { ok: false, error: "errors.invalidData" };
  try {
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      const rows = await tx.select().from(diningTables)
        .where(and(eq(diningTables.storeId, storeId), inArray(diningTables.id, [targetId, ...sources])))
        .for("update");
      const target = rows.find((r) => r.id === targetId);
      if (!target || rows.length !== sources.length + 1) {
        return { ok: false, error: "errors.invalidData" };
      }
      const merged = [...readCart(target.currentCart)];
      for (const sourceId of sources) {
        merged.push(...readCart(rows.find((row) => row.id === sourceId)?.currentCart));
      }
      await tx.update(diningTables).set({ currentCart: merged, status: "occupied", openedAt: target.openedAt ?? new Date() }).where(and(eq(diningTables.storeId, storeId), eq(diningTables.id, targetId)));
      await tx.update(kitchenTickets).set({ tableId: targetId, tableName: target.name }).where(and(eq(kitchenTickets.storeId, storeId), inArray(kitchenTickets.tableId, sources), eq(kitchenTickets.status, "active")));
      await tx.update(diningTables).set({ status: "free", currentCart: [], openedAt: null }).where(and(eq(diningTables.storeId, storeId), inArray(diningTables.id, sources)));
      if (target.status !== "occupied" || rows.some((row) => row.id !== targetId && (row.status !== "free" || readCart(row.currentCart).length > 0))) {
        await recordActivity(tx, {
          storeId, actorId, action: "table.merged", entityType: "table", entityId: targetId,
          before: { tables: rows.map((row) => ({ name: row.name, status: row.status, itemCount: readCart(row.currentCart).length })) },
          after: { name: target.name, status: "occupied", itemCount: merged.length, sourceNames: rows.filter((row) => row.id !== targetId).map((row) => row.name) },
          affectedRecords: rows.map((row) => ({ type: "table", id: row.id, name: row.name })),
        });
      }
      return { ok: true, data: undefined };
    });
    if (!result.ok) return result;
    revalidatePath("/tables"); revalidatePath("/kds");
    return result;
  } catch (e) { console.error("mergeTables failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Chuyển toàn bộ giỏ + phiếu bếp sang một bàn trống trong cùng transaction. */
export async function moveTable(sourceId: string, targetId: string): Promise<ActionResult> {
  let context; try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  return moveTableForUser(context.storeId, sourceId, targetId, context.userId);
}

export async function moveTableForUser(storeId: string, sourceId: string, targetId: string, actorId: string): Promise<ActionResult> {
  if (!sourceId || !targetId || sourceId === targetId) {
    return { ok: false, error: "errors.invalidData" };
  }
  try {
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      const rows = await tx
        .select()
        .from(diningTables)
        .where(and(eq(diningTables.storeId, storeId), inArray(diningTables.id, [sourceId, targetId])))
        .for("update");
      const source = rows.find((row) => row.id === sourceId);
      const target = rows.find((row) => row.id === targetId);
      if (!source || !target) return { ok: false, error: "errors.invalidData" };
      const sourceCart = readCart(source.currentCart);
      const targetCart = readCart(target.currentCart);
      if (sourceCart.length === 0) return { ok: false, error: "pos.errors.emptyCart" };
      if (target.status === "occupied" || targetCart.length > 0) {
        return { ok: false, error: "tables.errors.targetOccupied" };
      }
      await tx.update(diningTables).set({
        currentCart: sourceCart,
        status: "occupied",
        openedAt: source.openedAt ?? new Date(),
      }).where(and(eq(diningTables.storeId, storeId), eq(diningTables.id, targetId)));
      await tx.update(kitchenTickets).set({
        tableId: targetId,
        tableName: target.name,
      }).where(and(eq(kitchenTickets.storeId, storeId), eq(kitchenTickets.tableId, sourceId), eq(kitchenTickets.status, "active")));
      await tx.update(diningTables).set({
        status: "free",
        currentCart: [],
        openedAt: null,
      }).where(and(eq(diningTables.storeId, storeId), eq(diningTables.id, sourceId)));
      await recordActivity(tx, {
        storeId, actorId, action: "table.moved", entityType: "table", entityId: targetId,
        before: { name: source.name, status: source.status, itemCount: sourceCart.length },
        after: { name: target.name, status: "occupied", itemCount: sourceCart.length },
        affectedRecords: [{ type: "table", id: source.id, name: source.name }, { type: "table", id: target.id, name: target.name }],
      });
      return { ok: true, data: undefined };
    });
    if (!result.ok) return result;
    revalidatePath("/tables");
    revalidatePath("/kds");
    return result;
  } catch (e) {
    console.error("moveTable failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

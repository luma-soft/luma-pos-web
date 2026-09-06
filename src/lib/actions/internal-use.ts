"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  internalUseIssues, internalUseItems, products, warehouses, stockLevels, stockMovements,
} from "@/db/schema";
import { getAuthoritativeInternalUseWarehouse } from "@/lib/data/internal-use";
import { createInternalUseSchema, type CreateInternalUseInput } from "@/lib/schemas/internal-use";
import { type ActionResult, getProfileId, generateCode, requireStockAccess, toMoney, toQty } from "./common";
import { Routes } from "@/lib/routes";
import { consumeTrackedStockLots } from "@/lib/inventory/stock-lot-service";
import { canCreateInternalUse } from "@/lib/inventory/internal-use-policy";
import { recordActivity } from "@/lib/audit/activity-log";
import { reverseDocumentStockLots } from "@/lib/inventory/reverse-document-stock-lots";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StockItem = { productId: string; unitMultiplier: string; quantity: string; unitCost: string };

async function validateReferences(tx: Tx, storeId: string, warehouseId: string, items: { productId: string }[]) {
  const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.storeId, storeId), eq(warehouses.id, warehouseId))).limit(1);
  const ids = [...new Set(items.map((item) => item.productId))];
  const found = await tx.select({ id: products.id }).from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, ids)));
  if (!warehouse || found.length !== ids.length) throw new Error("INVALID_REFERENCE");
}

async function reverseStock(tx: Tx, storeId: string, issue: typeof internalUseIssues.$inferSelect, items: StockItem[], profileId: string | null) {
  if (issue.status !== "approved" || !issue.warehouseId) return;
  await reverseDocumentStockLots(tx, { storeId, refType: "internal_use", refId: issue.id, createdBy: profileId });
  for (const item of items) {
    const quantity = toQty(Number(item.quantity) * Number(item.unitMultiplier));
    await tx.insert(stockLevels).values({ storeId, productId: item.productId, warehouseId: issue.warehouseId, quantity })
      .onConflictDoUpdate({
        target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
        set: { quantity: sql`${stockLevels.quantity} + ${quantity}`, updatedAt: sql`now()` },
      });
    await tx.insert(stockMovements).values({
      storeId, productId: item.productId, warehouseId: issue.warehouseId, type: "internal_use", quantity,
      unitCost: item.unitCost, refType: "internal_use", refId: issue.id,
      note: `${issue.code} · Hoàn kho khi sửa/xóa phiếu`, createdBy: profileId,
    });
  }
}

/** Trừ kho + ghi movement 'internal_use' (giá vốn) cho từng dòng. */
async function postStock(
  tx: Tx,
  storeId: string,
  issue: { id: string; code: string; warehouseId: string | null; reason: string | null },
  items: StockItem[],
  profileId: string | null,
) {
  if (!issue.warehouseId) return;
  for (const it of items) {
    const baseQty = Number(it.quantity) * Number(it.unitMultiplier);
    await consumeTrackedStockLots(tx, {
      storeId,
      productId: it.productId,
      warehouseId: issue.warehouseId,
      quantity: baseQty,
      refType: "internal_use",
      refId: issue.id,
      createdBy: profileId,
    });
    await tx.insert(stockLevels)
      .values({ storeId, productId: it.productId, warehouseId: issue.warehouseId, quantity: toQty(-baseQty) })
      .onConflictDoUpdate({
        target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
        set: { quantity: sql`${stockLevels.quantity} - ${toQty(baseQty)}`, updatedAt: sql`now()` },
      });
    await tx.insert(stockMovements).values({
      storeId,
      productId: it.productId,
      warehouseId: issue.warehouseId,
      type: "internal_use",
      quantity: toQty(-baseQty),
      unitCost: it.unitCost,
      refType: "internal_use",
      refId: issue.id,
      note: `${issue.code}${issue.reason ? ` · ${issue.reason}` : ""}`,
      createdBy: profileId,
    });
  }
}

export async function createInternalUse(
  input: CreateInternalUseInput,
): Promise<ActionResult<{ id: string; code: string; status: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;

  const parsed = createInternalUseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const profileId = await getProfileId(gate.userId);
    if (!canCreateInternalUse(gate.role)) {
      return { ok: false, error: "errors.forbidden" };
    }
    const warehouseId = v.warehouseId ?? (await getAuthoritativeInternalUseWarehouse(gate.storeId))?.id ?? null;
    if (!warehouseId) return { ok: false, error: "errors.invalidData" };

    const totalCost = v.items.reduce((s, i) => s + i.unitCost * i.quantity, 0);
    const status = v.intent === "draft" ? "draft" : "approved";

    const result = await db.transaction(async (tx) => {
      await validateReferences(tx, gate.storeId, warehouseId, v.items);
      const [issue] = await tx.insert(internalUseIssues).values({
        storeId: gate.storeId,
        code: generateCode("XNB"),
        warehouseId,
        department: v.department || null,
        reason: v.reason || null,
        status,
        totalCost: toMoney(totalCost),
        note: v.note || null,
        createdBy: profileId,
        approvedBy: status === "approved" ? profileId : null,
        approvedAt: status === "approved" ? sql`now()` : null,
      }).returning({ id: internalUseIssues.id, code: internalUseIssues.code });

      const items: StockItem[] = v.items.map((i) => ({
        productId: i.productId,
        unitMultiplier: toQty(i.unitMultiplier),
        quantity: toQty(i.quantity),
        unitCost: toMoney(i.unitCost),
      }));
      await tx.insert(internalUseItems).values(v.items.map((i) => ({
        storeId: gate.storeId,
        issueId: issue.id,
        productId: i.productId,
        productName: i.productName,
        unitName: i.unitName,
        unitMultiplier: toQty(i.unitMultiplier),
        quantity: toQty(i.quantity),
        unitCost: toMoney(i.unitCost),
        total: toMoney(i.unitCost * i.quantity),
      })));

      if (status === "approved") {
        await postStock(tx, gate.storeId, { id: issue.id, code: issue.code, warehouseId, reason: v.reason || null }, items, profileId);
      }
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: "internal_use.created", entityType: "internal_use", entityId: issue.id,
        after: { code: issue.code, status, total: totalCost, itemCount: v.items.length, department: v.department, reason: v.reason },
        affectedRecords: v.items.map((item) => ({ type: "product", id: item.productId, name: item.productName, quantity: item.quantity })),
        metadata: { code: issue.code, warehouseId },
      });
      return { ...issue, status };
    });

    revalidatePath(Routes.Inventory);
    return { ok: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_REFERENCE") return { ok: false, error: "errors.invalidData" };
    if (e instanceof Error && e.message === "INSUFFICIENT_BATCH_STOCK") {
      return { ok: false, error: "inventory.errors.insufficientBatchStock" };
    }
    console.error("createInternalUse failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateInternalUse(id: string, input: CreateInternalUseInput): Promise<ActionResult<{ id: string; code: string; status: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  if (!canCreateInternalUse(gate.role)) return { ok: false, error: "errors.forbidden" };
  const parsed = createInternalUseSchema.safeParse(input);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const profileId = await getProfileId(gate.userId);
    const result = await db.transaction(async (tx) => {
      const [issue] = await tx.select().from(internalUseIssues)
        .where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id))).limit(1).for("update");
      if (!issue) throw new Error("NOT_FOUND");
      if (issue.status !== "draft" && issue.status !== "pending" && issue.status !== "approved") throw new Error("INVALID_STATE");
      if (v.intent === "draft" && issue.status === "approved") throw new Error("INVALID_STATE");
      if (v.intent === "complete" && issue.status === "pending" && gate.role !== "owner" && gate.role !== "manager") throw new Error("FORBIDDEN");
      const nextStatus = v.intent === "complete" ? "approved" : issue.status;
      const warehouseId = v.warehouseId ?? issue.warehouseId;
      if (!warehouseId) throw new Error("INVALID_REFERENCE");
      await validateReferences(tx, gate.storeId, warehouseId, v.items);
      const oldItems = await tx.select().from(internalUseItems)
        .where(and(eq(internalUseItems.storeId, gate.storeId), eq(internalUseItems.issueId, id)));
      await reverseStock(tx, gate.storeId, issue, oldItems, profileId);
      await tx.delete(internalUseItems).where(and(eq(internalUseItems.storeId, gate.storeId), eq(internalUseItems.issueId, id)));
      const items = v.items.map((item) => ({
        storeId: gate.storeId, issueId: id, productId: item.productId, productName: item.productName,
        unitName: item.unitName, unitMultiplier: toQty(item.unitMultiplier), quantity: toQty(item.quantity),
        unitCost: toMoney(item.unitCost), total: toMoney(item.unitCost * item.quantity),
      }));
      await tx.insert(internalUseItems).values(items);
      const totalCost = toMoney(v.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));
      await tx.update(internalUseIssues).set({ warehouseId, department: v.department || null, reason: v.reason || null, note: v.note || null, totalCost, status: nextStatus,
          ...(nextStatus === "approved" && issue.status !== "approved" ? { approvedBy: profileId, approvedAt: sql`now()` } : {}) })
        .where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id)));
      if (nextStatus === "approved") await postStock(tx, gate.storeId, { ...issue, warehouseId, reason: v.reason || null }, items, profileId);
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: "internal_use.updated", entityType: "internal_use", entityId: id,
        before: { ...issue, items: oldItems }, after: { code: issue.code, status: nextStatus, warehouseId, totalCost, items },
        affectedRecords: v.items.map((item) => ({ type: "product", id: item.productId, name: item.productName, quantity: item.quantity })),
        metadata: { code: issue.code, warehouseId },
      });
      return { id, code: issue.code, status: nextStatus };
    });
    revalidatePath(Routes.Inventory);
    return { ok: true, data: result };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "FORBIDDEN") return { ok: false, error: "errors.forbidden" };
      if (e.message === "NOT_FOUND") return { ok: false, error: "errors.notFound" };
      if (e.message === "INVALID_REFERENCE" || e.message === "INVALID_STATE") return { ok: false, error: "errors.invalidData" };
      if (e.message === "INSUFFICIENT_BATCH_STOCK") return { ok: false, error: "inventory.errors.insufficientBatchStock" };
    }
    console.error("updateInternalUse failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deleteInternalUse(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  if (!canCreateInternalUse(gate.role)) return { ok: false, error: "errors.forbidden" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "errors.invalidData" };
  try {
    const profileId = await getProfileId(gate.userId);
    await db.transaction(async (tx) => {
      const [issue] = await tx.select().from(internalUseIssues)
        .where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id))).limit(1).for("update");
      if (!issue) throw new Error("NOT_FOUND");
      if (issue.status !== "draft" && issue.status !== "pending" && issue.status !== "approved") throw new Error("INVALID_STATE");
      const items = await tx.select().from(internalUseItems)
        .where(and(eq(internalUseItems.storeId, gate.storeId), eq(internalUseItems.issueId, id)));
      await reverseStock(tx, gate.storeId, issue, items, profileId);
      await tx.delete(internalUseItems).where(and(eq(internalUseItems.storeId, gate.storeId), eq(internalUseItems.issueId, id)));
      await tx.delete(internalUseIssues).where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: "internal_use.deleted", entityType: "internal_use", entityId: id,
        before: { ...issue, items },
        affectedRecords: items.map((item) => ({ type: "product", id: item.productId, name: item.productName, quantity: Number(item.quantity) })),
        metadata: { code: issue.code, warehouseId: issue.warehouseId },
      });
    });
    revalidatePath(Routes.Inventory);
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return { ok: false, error: "errors.notFound" };
    if (e instanceof Error && e.message === "INVALID_STATE") return { ok: false, error: "errors.invalidData" };
    console.error("deleteInternalUse failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function approveInternalUse(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "errors.invalidData" };

  try {
    const profileId = await getProfileId(gate.userId);
    await db.transaction(async (tx) => {
      const [issue] = await tx.select().from(internalUseIssues).where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id))).limit(1).for("update");
      if (!issue || (issue.status !== "pending" && issue.status !== "draft")) throw new Error("INVALID_STATE");
      if (issue.status === "pending" && gate.role !== "owner" && gate.role !== "manager") throw new Error("FORBIDDEN");
      const items = await tx.select().from(internalUseItems).where(and(eq(internalUseItems.storeId, gate.storeId), eq(internalUseItems.issueId, id)));
      if (!issue.warehouseId || items.length === 0) throw new Error("INVALID_STATE");
      await validateReferences(tx, gate.storeId, issue.warehouseId, items);
      await postStock(tx, gate.storeId, { id: issue.id, code: issue.code, warehouseId: issue.warehouseId, reason: issue.reason }, items, profileId);
      await tx.update(internalUseIssues).set({ status: "approved", approvedBy: profileId, approvedAt: sql`now()` }).where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: "internal_use.approved", entityType: "internal_use", entityId: id,
        before: { code: issue.code, status: issue.status },
        after: { code: issue.code, status: "approved", total: Number(issue.totalCost), itemCount: items.length },
        affectedRecords: items.map((item) => ({ type: "product", id: item.productId, name: item.productName, quantity: Number(item.quantity) })),
        metadata: { code: issue.code, warehouseId: issue.warehouseId },
      });
    });
    revalidatePath(Routes.Inventory);
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_BATCH_STOCK") {
      return { ok: false, error: "inventory.errors.insufficientBatchStock" };
    }
    if (e instanceof Error && e.message === "FORBIDDEN") return { ok: false, error: "errors.forbidden" };
    if (e instanceof Error && (e.message === "INVALID_STATE" || e.message === "INVALID_REFERENCE")) return { ok: false, error: "errors.invalidData" };
    console.error("approveInternalUse failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

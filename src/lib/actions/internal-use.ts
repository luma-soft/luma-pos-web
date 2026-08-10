"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  internalUseIssues, internalUseItems, stockLevels, stockMovements,
} from "@/db/schema";
import { getAuthoritativeInternalUseWarehouse } from "@/lib/data/internal-use";
import { createInternalUseSchema, type CreateInternalUseInput } from "@/lib/schemas/internal-use";
import { type ActionResult, getProfileId, generateCode, requireStockAccess, toMoney, toQty } from "./common";
import { Routes } from "@/lib/routes";
import { consumeTrackedStockLots } from "@/lib/inventory/stock-lot-service";
import { canCreateInternalUse } from "@/lib/inventory/internal-use-policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StockItem = { productId: string; unitMultiplier: string; quantity: string; unitCost: string };

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
    const status = "approved";

    const result = await db.transaction(async (tx) => {
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
      return { ...issue, status };
    });

    revalidatePath(Routes.Inventory);
    return { ok: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_BATCH_STOCK") {
      return { ok: false, error: "inventory.errors.insufficientBatchStock" };
    }
    console.error("createInternalUse failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function approveInternalUse(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  if (gate.role !== "owner" && gate.role !== "manager") return { ok: false, error: "errors.forbidden" };

  try {
    const profileId = await getProfileId(gate.userId);
    await db.transaction(async (tx) => {
      const [issue] = await tx.select().from(internalUseIssues).where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id))).limit(1);
      if (!issue || issue.status !== "pending") throw new Error("INVALID_STATE");
      const items = await tx.select().from(internalUseItems).where(and(eq(internalUseItems.storeId, gate.storeId), eq(internalUseItems.issueId, id)));
      await postStock(tx, gate.storeId, { id: issue.id, code: issue.code, warehouseId: issue.warehouseId, reason: issue.reason }, items, profileId);
      await tx.update(internalUseIssues).set({ status: "approved", approvedBy: profileId, approvedAt: sql`now()` }).where(and(eq(internalUseIssues.storeId, gate.storeId), eq(internalUseIssues.id, id)));
    });
    revalidatePath(Routes.Inventory);
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_BATCH_STOCK") {
      return { ok: false, error: "inventory.errors.insufficientBatchStock" };
    }
    console.error("approveInternalUse failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

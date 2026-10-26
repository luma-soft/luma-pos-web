"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, stockLevels, stockLotMovements, stockLots, stockMovements, stocktakeItems, stocktakes } from "@/db/schema";
import { type ActionResult, requireManager, requireStockAccess, getProfileId, generateCode, toQty } from "./common";
import { Routes } from "@/lib/routes";
import { recordActivity } from "@/lib/audit/activity-log";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { reverseDocumentStockLots } from "@/lib/inventory/reverse-document-stock-lots";
import {
  consumeTrackedStockLots,
  receiveUnspecifiedTrackedStockLot,
} from "@/lib/inventory/stock-lot-service";

const createSchema = z.object({
  warehouseId: z.uuid(),
  note: z.string().optional(),
  balanceNow: z.boolean().default(false), // Hoàn thành ngay (cân bằng kho) hay Lưu tạm
  items: z.array(z.object({
    productId: z.uuid(),
    actualQty: z.number().min(0),
  })).min(1, { error: "stocktakes.errors.emptyItems" }),
});
export type CreateStocktakeInput = z.input<typeof createSchema>;

/** Tạo phiếu kiểm kho — snapshot tồn hệ thống tại thời điểm kiểm. */
export async function createStocktake(
  input: CreateStocktakeInput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const userId = gate.userId;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  // 1 SP chỉ xuất hiện 1 lần trong phiếu
  const ids = v.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "errors.invalidData" };

  try {
    const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const [st] = await tx.insert(stocktakes).values({
        storeId: gate.storeId,
        code: generateCode("KK"),
        warehouseId: v.warehouseId,
        status: "draft",
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: stocktakes.id, code: stocktakes.code });

      // snapshot tồn hệ thống
      const levels = await tx
        .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
        .from(stockLevels)
        .where(and(
          eq(stockLevels.storeId, gate.storeId),
          eq(stockLevels.warehouseId, v.warehouseId),
          inArray(stockLevels.productId, ids),
        ));
      const sysByProduct = new Map(levels.map((l) => [l.productId, Number(l.quantity)]));
      const productRows = await tx.select({ id: products.id, name: products.name, sku: products.sku }).from(products)
        .where(and(eq(products.storeId, gate.storeId), inArray(products.id, ids)));
      const productsById = new Map(productRows.map((product) => [product.id, product]));

      await tx.insert(stocktakeItems).values(
        v.items.map((i) => ({
          storeId: gate.storeId,
          stocktakeId: st.id,
          productId: i.productId,
          systemQty: toQty(sysByProduct.get(i.productId) ?? 0),
          actualQty: toQty(i.actualQty),
        }))
      );

      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: "stocktake.created", entityType: "stocktake", entityId: st.id,
        after: { code: st.code, status: "draft", itemCount: v.items.length },
        affectedRecords: v.items.map((item) => ({ type: "product", id: item.productId, name: productsById.get(item.productId)?.name, code: productsById.get(item.productId)?.sku, beforeQuantity: sysByProduct.get(item.productId) ?? 0, quantity: item.actualQty })),
        metadata: { code: st.code, warehouseId: v.warehouseId },
      });
      return st;
    });

    if (v.balanceNow) {
      const balanced = await balanceStocktake(result.id);
      if (!balanced.ok) return balanced as ActionResult<{ id: string; code: string }>;
    }

    revalidatePath(Routes.Stocktakes);
    return { ok: true, data: result };
  } catch (e) {
    console.error("createStocktake failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/**
 * Cân bằng kho: set tồn = SL thực tế đã đếm, ghi movement 'adjust' phần lệch
 * (lệch tính theo tồn hệ thống TẠI THỜI ĐIỂM CÂN BẰNG — không phải lúc tạo phiếu).
 */
export async function balanceStocktake(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  try {
    const profileId = await getProfileId(userId);

    await db.transaction(async (tx) => {
      const [st] = await tx.select().from(stocktakes).where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id))).limit(1).for("update");
      if (!st) throw new Error("NOT_FOUND");
      if (st.status !== "draft") throw new Error("NOT_DRAFT");

      const items = await tx.select().from(stocktakeItems).where(and(eq(stocktakeItems.storeId, gate.storeId), eq(stocktakeItems.stocktakeId, id)));
      const productRows = items.length ? await tx.select({ id: products.id, name: products.name, sku: products.sku }).from(products)
        .where(and(eq(products.storeId, gate.storeId), inArray(products.id, items.map((item) => item.productId)))) : [];
      const productsById = new Map(productRows.map((product) => [product.id, product]));

      const stockChanges: { type: string; id: string; name?: string; code?: string; beforeQuantity: number; quantity: number }[] = [];
      for (const i of items) {
        const [level] = await tx
          .select({ quantity: stockLevels.quantity })
          .from(stockLevels)
          .where(and(
            eq(stockLevels.storeId, gate.storeId),
            eq(stockLevels.productId, i.productId),
            eq(stockLevels.warehouseId, st.warehouseId),
          ))
          .limit(1);
        const current = Number(level?.quantity ?? 0);
        const actual = Number(i.actualQty);
        const diff = actual - current;
        if (Math.abs(diff) > 1e-9) stockChanges.push({ type: "product", id: i.productId, name: productsById.get(i.productId)?.name, code: productsById.get(i.productId)?.sku, beforeQuantity: current, quantity: actual });

        if (diff < -1e-9) {
          await consumeTrackedStockLots(tx, {
            storeId: gate.storeId,
            productId: i.productId,
            warehouseId: st.warehouseId,
            quantity: Math.abs(diff),
            refType: "stocktake",
            refId: st.id,
            createdBy: profileId,
          });
        } else if (diff > 1e-9) {
          await receiveUnspecifiedTrackedStockLot(tx, {
            storeId: gate.storeId,
            productId: i.productId,
            warehouseId: st.warehouseId,
            quantity: diff,
            batchNumber: `ADJUST-${st.code}`,
            refType: "stocktake",
            refId: st.id,
            createdBy: profileId,
          });
        }

        // set tồn = thực tế
        await tx
          .insert(stockLevels)
          .values({ storeId: gate.storeId, productId: i.productId, warehouseId: st.warehouseId, quantity: toQty(actual) })
          .onConflictDoUpdate({
            target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
            set: { quantity: toQty(actual), updatedAt: sql`now()` },
          });

        if (Math.abs(diff) > 1e-9) {
          await tx.insert(stockMovements).values({
            storeId: gate.storeId,
            productId: i.productId,
            warehouseId: st.warehouseId,
            type: "adjust",
            quantity: toQty(diff),
            refType: "stocktake",
            refId: st.id,
            note: `${st.code} · cân bằng kho`,
            createdBy: profileId,
          });
        }
      }

      await tx.update(stocktakes).set({
        status: "balanced",
        balancedAt: sql`now()`,
      }).where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: "stocktake.balanced", entityType: "stocktake", entityId: id,
        before: { code: st.code, status: st.status },
        after: { code: st.code, status: "balanced", itemCount: items.length, changedCount: stockChanges.length },
        affectedRecords: stockChanges,
        metadata: { code: st.code, warehouseId: st.warehouseId },
      });
    });

    revalidatePath(Routes.Stocktakes);
    revalidatePath(Routes.Inventory);
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_DRAFT") return { ok: false, error: "stocktakes.errors.notDraft" };
    if (msg === "INSUFFICIENT_BATCH_STOCK") {
      return { ok: false, error: "stocktakes.errors.insufficientBatchStock" };
    }
    console.error("balanceStocktake failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Hủy phiếu tạm hoặc đảo an toàn các điều chỉnh của phiếu đã cân bằng. */
export async function cancelStocktake(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [st] = await tx.select().from(stocktakes).where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id))).limit(1).for("update");
      if (!st || (st.status !== "draft" && st.status !== "balanced")) throw new Error("NOT_CANCELLABLE");
      if (st.status === "balanced" && !canViewPurchasePrices(gate.role)) throw new Error("MANAGER_REQUIRED");

      const stockChanges: { type: string; id: string; name?: string; code?: string; beforeQuantity: number; quantity: number }[] = [];
      if (st.status === "balanced") {
        const movements = await tx.select({
          productId: stockMovements.productId,
          warehouseId: stockMovements.warehouseId,
          quantity: stockMovements.quantity,
          unitCost: stockMovements.unitCost,
          name: products.name,
          sku: products.sku,
        }).from(stockMovements)
          .innerJoin(products, and(eq(products.id, stockMovements.productId), eq(products.storeId, gate.storeId)))
          .where(and(
            eq(stockMovements.storeId, gate.storeId),
            eq(stockMovements.refType, "stocktake"),
            eq(stockMovements.refId, st.id),
            eq(stockMovements.type, "adjust"),
          ))
          .orderBy(asc(stockMovements.warehouseId), asc(stockMovements.productId));

        const changedProductIds = [...new Set(movements.filter((movement) => Number(movement.quantity) > 0).map((movement) => movement.productId))];
        const receivedLots = changedProductIds.length > 0
          ? await tx.select({
            id: stockLots.id,
            receivedQuantity: stockLots.receivedQuantity,
            availableQuantity: stockLots.availableQuantity,
            quantity: stockLotMovements.quantity,
          }).from(stockLotMovements)
            .innerJoin(stockLots, eq(stockLots.id, stockLotMovements.stockLotId))
            .where(and(
              eq(stockLotMovements.storeId, gate.storeId),
              eq(stockLotMovements.refType, "stocktake"),
              eq(stockLotMovements.refId, st.id),
              inArray(stockLots.productId, changedProductIds),
              gt(stockLotMovements.quantity, "0"),
            ))
            .for("update")
          : [];
        if (receivedLots.some((lot) => Number(lot.availableQuantity) + 1e-9 < Number(lot.receivedQuantity))) {
          throw new Error("ADJUSTMENT_ALREADY_USED");
        }

        await reverseDocumentStockLots(tx, {
          storeId: gate.storeId,
          refType: "stocktake",
          refId: st.id,
          createdBy: gate.userId,
        });

        for (const lot of receivedLots) {
          const quantity = Number(lot.quantity);
          if (quantity <= 0) continue;
          await tx.update(stockLots).set({
            availableQuantity: sql`${stockLots.availableQuantity} - ${toQty(quantity)}`,
          }).where(and(eq(stockLots.storeId, gate.storeId), eq(stockLots.id, lot.id)));
          await tx.insert(stockLotMovements).values({
            storeId: gate.storeId,
            stockLotId: lot.id,
            quantity: toQty(-quantity),
            refType: "stocktake",
            refId: st.id,
            createdBy: gate.userId,
          });
        }

        for (const movement of movements) {
          const [level] = await tx.select({ quantity: stockLevels.quantity })
            .from(stockLevels)
            .where(and(
              eq(stockLevels.storeId, gate.storeId),
              eq(stockLevels.productId, movement.productId),
              eq(stockLevels.warehouseId, movement.warehouseId),
            ))
            .limit(1)
            .for("update");
          const beforeQuantity = Number(level?.quantity ?? 0);
          const quantity = beforeQuantity - Number(movement.quantity);
          await tx.insert(stockLevels).values({
            storeId: gate.storeId,
            productId: movement.productId,
            warehouseId: movement.warehouseId,
            quantity: toQty(quantity),
          }).onConflictDoUpdate({
            target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
            set: { quantity: toQty(quantity), updatedAt: sql`now()` },
          });
          await tx.insert(stockMovements).values({
            storeId: gate.storeId,
            productId: movement.productId,
            warehouseId: movement.warehouseId,
            type: "adjust",
            quantity: toQty(-Number(movement.quantity)),
            unitCost: movement.unitCost,
            refType: "stocktake_cancel",
            refId: st.id,
            note: `${st.code} · hủy phiếu kiểm kho`,
            createdBy: gate.userId,
          });
          stockChanges.push({
            type: "product",
            id: movement.productId,
            name: movement.name,
            code: movement.sku,
            beforeQuantity,
            quantity,
          });
        }
      }

      await tx.update(stocktakes).set({ status: "cancelled" }).where(and(eq(stocktakes.storeId, gate.storeId), eq(stocktakes.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "stocktake.cancelled", entityType: "stocktake", entityId: id,
        before: { code: st.code, status: st.status }, after: { code: st.code, status: "cancelled", reversedCount: stockChanges.length },
        affectedRecords: stockChanges,
        metadata: { code: st.code, warehouseId: st.warehouseId },
      });
    });
    revalidatePath(Routes.Stocktakes);
    revalidatePath(Routes.Inventory);
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_DRAFT") return { ok: false, error: "stocktakes.errors.notDraft" };
    if (msg === "NOT_CANCELLABLE") return { ok: false, error: "stocktakes.errors.notCancellable" };
    if (msg === "MANAGER_REQUIRED") return { ok: false, error: "errors.forbidden" };
    if (msg === "ADJUSTMENT_ALREADY_USED") return { ok: false, error: "stocktakes.errors.adjustmentAlreadyUsed" };
    console.error("cancelStocktake failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

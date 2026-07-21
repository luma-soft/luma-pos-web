"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { stockLevels, stockMovements, stocktakeItems, stocktakes } from "@/db/schema";
import { type ActionResult, requireManager, requireStockAccess, getProfileId, generateCode, toQty } from "./common";
import { Routes } from "@/lib/routes";
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
        .where(and(eq(stockLevels.warehouseId, v.warehouseId), inArray(stockLevels.productId, ids)));
      const sysByProduct = new Map(levels.map((l) => [l.productId, Number(l.quantity)]));

      await tx.insert(stocktakeItems).values(
        v.items.map((i) => ({
          stocktakeId: st.id,
          productId: i.productId,
          systemQty: toQty(sysByProduct.get(i.productId) ?? 0),
          actualQty: toQty(i.actualQty),
        }))
      );

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
      const [st] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1);
      if (!st) throw new Error("NOT_FOUND");
      if (st.status !== "draft") throw new Error("NOT_DRAFT");

      const items = await tx.select().from(stocktakeItems).where(eq(stocktakeItems.stocktakeId, id));

      for (const i of items) {
        const [level] = await tx
          .select({ quantity: stockLevels.quantity })
          .from(stockLevels)
          .where(and(eq(stockLevels.productId, i.productId), eq(stockLevels.warehouseId, st.warehouseId)))
          .limit(1);
        const current = Number(level?.quantity ?? 0);
        const actual = Number(i.actualQty);
        const diff = actual - current;

        if (diff < -1e-9) {
          await consumeTrackedStockLots(tx, {
            productId: i.productId,
            warehouseId: st.warehouseId,
            quantity: Math.abs(diff),
            refType: "stocktake",
            refId: st.id,
            createdBy: profileId,
          });
        } else if (diff > 1e-9) {
          await receiveUnspecifiedTrackedStockLot(tx, {
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
          .values({ productId: i.productId, warehouseId: st.warehouseId, quantity: toQty(actual) })
          .onConflictDoUpdate({
            target: [stockLevels.productId, stockLevels.warehouseId],
            set: { quantity: toQty(actual), updatedAt: sql`now()` },
          });

        if (Math.abs(diff) > 1e-9) {
          await tx.insert(stockMovements).values({
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
      }).where(eq(stocktakes.id, id));
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

/** Hủy phiếu tạm (chưa cân bằng — không ảnh hưởng kho). */
export async function cancelStocktake(id: string): Promise<ActionResult> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  try {
    await db.transaction(async (tx) => {
      const [st] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1);
      if (!st || st.status !== "draft") throw new Error("NOT_DRAFT");
      await tx.update(stocktakes).set({ status: "cancelled" }).where(eq(stocktakes.id, id));
    });
    revalidatePath(Routes.Stocktakes);
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_DRAFT") return { ok: false, error: "stocktakes.errors.notDraft" };
    console.error("cancelStocktake failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  notificationEvents,
  warehouses,
  purchaseOrders,
  products,
  purchaseReturnItems,
  purchaseReturns,
  stockLevels,
  stockMovements,
  suppliers,
} from "@/db/schema";
import { createPurchaseReturnSchema, type CreatePurchaseReturnOutput } from "@/lib/schemas/purchase-returns";
import { searchPurchaseReturnProductRows, type PurchaseReturnProductRow } from "@/lib/data/purchase-returns";
import { recordCashTx } from "@/lib/cash";
import { Routes } from "@/lib/routes";
import { type ActionResult, generateCode, getProfileId, requireStockAccess, requireManager, toMoney, toQty } from "./common";
import { getCurrentShift } from "@/lib/data/shifts";
import { consumeTrackedStockLots } from "@/lib/inventory/stock-lot-service";
import { createDebtChangedEventInTx } from "@/lib/notifications/events-core";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import { reverseDocumentStockLots } from "@/lib/inventory/reverse-document-stock-lots";
import { randomUUID } from "node:crypto";
import { recordActivity } from "@/lib/audit/activity-log";

export async function searchPurchaseReturnProducts(q: string, warehouseId: string): Promise<PurchaseReturnProductRow[]> {
  const gate = await requireStockAccess();
  if (!gate.ok) return [];
  return searchPurchaseReturnProductRows(gate.storeId, q, warehouseId);
}

function lineTotal(i: { quantity: number; returnUnitCost: number }) {
  return Math.max(0, i.quantity * i.returnUnitCost);
}

function calcTotals(v: Pick<CreatePurchaseReturnOutput, "items" | "discount" | "vatRate" | "refundAmount" | "debtAmount">) {
  const subtotal = v.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const afterDiscount = Math.max(0, subtotal - v.discount);
  const tax = Math.round((afterDiscount * v.vatRate) / 100);
  const total = afterDiscount + tax;
  const refundAmount = Math.min(v.refundAmount, total);
  const debtAmount = Math.min(v.debtAmount, Math.max(0, total - refundAmount));
  const settled = refundAmount + debtAmount;
  const settlementStatus = settled <= 0 ? "unsettled" : settled >= total - 1e-9 ? "settled" : "partial";
  return { subtotal, tax, total, refundAmount, debtAmount, settlementStatus };
}

function revalidatePurchaseReturnPaths(id?: string) {
  revalidatePath(Routes.Inventory);
  revalidatePath(Routes.PurchaseReturns);
  revalidatePath(Routes.Products);
  revalidatePath(Routes.Suppliers);
  revalidatePath(Routes.Finance);
  if (id) revalidatePath(Routes.purchaseReturn(id));
}

export async function createPurchaseReturn(input: CreatePurchaseReturnOutput): Promise<ActionResult<{ id: string; code: string }>> {
  return savePurchaseReturn(input);
}

export async function updatePurchaseReturn(id: string, input: CreatePurchaseReturnOutput): Promise<ActionResult<{ id: string; code: string }>> {
  return savePurchaseReturn(input, id);
}

async function savePurchaseReturn(input: CreatePurchaseReturnOutput, id?: string): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await (id ? requireManager() : requireStockAccess());
  if (!gate.ok) return gate;
  const userId = gate.userId;

  const parsed = createPurchaseReturnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const totals = calcTotals(v);

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(gate.storeId, profileId) : null;

    const result = await db.transaction(async (tx) => {
      const [supplierCheck] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.storeId, gate.storeId), eq(suppliers.id, v.supplierId))).limit(1);
      const [warehouseCheck] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.storeId, gate.storeId), eq(warehouses.id, v.warehouseId))).limit(1);
      if (!supplierCheck || !warehouseCheck) throw new Error("PRODUCT_NOT_FOUND");
      if (v.purchaseOrderId) {
        const [purchase] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.storeId, gate.storeId), eq(purchaseOrders.id, v.purchaseOrderId), eq(purchaseOrders.supplierId, v.supplierId))).limit(1);
        if (!purchase) throw new Error("PRODUCT_NOT_FOUND");
      }
      const previous = id ? await reversePurchaseReturn(tx, gate.storeId, id, profileId, currentShift?.id ?? null) : null;
      const originalItems = previous ? await tx.select().from(purchaseReturnItems).where(and(eq(purchaseReturnItems.storeId, gate.storeId), eq(purchaseReturnItems.purchaseReturnId, previous.id))) : [];
      const originalStock = new Map<string, number>();
      if (previous?.status === "completed" && previous.warehouseId === v.warehouseId) for (const item of originalItems) {
        originalStock.set(item.productId, (originalStock.get(item.productId) ?? 0) + Number(item.quantity) * Number(item.unitMultiplier));
      }
      const ids = v.items.map((item) => item.productId);
      const productRows = await tx
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          baseUnit: products.baseUnit,
        })
        .from(products)
        .where(and(eq(products.storeId, gate.storeId), inArray(products.id, ids)));
      if (productRows.length !== new Set(ids).size) throw new Error("PRODUCT_NOT_FOUND");
      const productsById = new Map(productRows.map((product) => [product.id, product]));

      const stockRows = await tx
        .select({
          productId: stockLevels.productId,
          quantity: stockLevels.quantity,
        })
        .from(stockLevels)
        .where(and(eq(stockLevels.storeId, gate.storeId), eq(stockLevels.warehouseId, v.warehouseId), inArray(stockLevels.productId, ids))).for("update");
      const stockByProduct = new Map(stockRows.map((row) => [row.productId, Number(row.quantity)]));
      // Existing historical deficits may remain, but an edit must not increase them.
      for (const [productId, quantity] of originalStock) stockByProduct.set(productId, Math.max(stockByProduct.get(productId) ?? 0, quantity));
      for (const item of v.items) {
        const available = stockByProduct.get(item.productId) ?? 0;
        const baseQuantity = item.quantity * (item.unitMultiplier ?? 1);
        if (baseQuantity > available + 1e-9) throw new Error("INSUFFICIENT_STOCK");
        stockByProduct.set(item.productId, available - baseQuantity);
      }

      const values = {
        storeId: gate.storeId,
        code: previous?.code ?? generateCode("THN"),
        purchaseOrderId: v.purchaseOrderId ?? null,
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        status: "completed",
        settlementStatus: totals.settlementStatus,
        subtotal: toMoney(totals.subtotal),
        discount: toMoney(v.discount),
        vatRate: String(v.vatRate),
        tax: toMoney(totals.tax),
        totalRefund: toMoney(totals.total),
        refundAmount: toMoney(totals.refundAmount),
        refundMethod: totals.refundAmount > 0 ? (v.refundMethod ?? "cash") : null,
        debtAmount: toMoney(totals.debtAmount),
        note: v.note || null,
        createdBy: previous?.createdBy ?? profileId,
      };
      const [ret] = previous
        ? await tx.update(purchaseReturns).set(values).where(and(eq(purchaseReturns.storeId, gate.storeId), eq(purchaseReturns.id, previous.id))).returning({ id: purchaseReturns.id, code: purchaseReturns.code })
        : await tx.insert(purchaseReturns).values(values).returning({ id: purchaseReturns.id, code: purchaseReturns.code });
      if (previous) await tx.delete(purchaseReturnItems).where(and(eq(purchaseReturnItems.storeId, gate.storeId), eq(purchaseReturnItems.purchaseReturnId, previous.id)));

      await tx.insert(purchaseReturnItems).values(v.items.map((item) => {
        const product = productsById.get(item.productId)!;
        return {
          storeId: gate.storeId,
          purchaseReturnId: ret.id,
          purchaseOrderItemId: null,
          productId: item.productId,
          productName: product.name,
          sku: product.sku,
          unitName: item.unitName ?? product.baseUnit,
          unitMultiplier: toQty(item.unitMultiplier ?? 1),
          quantity: toQty(item.quantity),
          unitCost: toMoney(item.unitCost),
          returnUnitCost: toMoney(item.returnUnitCost),
          total: toMoney(lineTotal(item)),
        };
      }));

      for (const item of v.items) {
        const baseQuantity = item.quantity * (item.unitMultiplier ?? 1);
        await consumeTrackedStockLots(tx, {
          storeId: gate.storeId,
          productId: item.productId,
          warehouseId: v.warehouseId,
          quantity: baseQuantity,
          refType: "purchase_return",
          refId: ret.id,
          createdBy: profileId,
        });
        await tx.update(stockLevels).set({
          quantity: sql`${stockLevels.quantity} - ${toQty(baseQuantity)}`,
          updatedAt: sql`now()`,
        }).where(and(eq(stockLevels.storeId, gate.storeId), eq(stockLevels.productId, item.productId), eq(stockLevels.warehouseId, v.warehouseId)));

        await tx.insert(stockMovements).values({
          storeId: gate.storeId,
          productId: item.productId,
          warehouseId: v.warehouseId,
          type: "return_out",
          quantity: toQty(-baseQuantity),
          unitCost: toMoney(item.returnUnitCost),
          refType: "purchase_return",
          refId: ret.id,
          note: ret.code,
          createdBy: profileId,
        });
      }

      if (totals.refundAmount > 0) {
        await recordCashTx(tx, {
          storeId: gate.storeId,
          type: "in",
          fund: v.refundMethod === "bank_transfer" ? "bank" : "cash",
          amount: totals.refundAmount,
          category: "supplier_payment",
          refType: "purchase_return",
          refId: ret.id,
          note: `NCC hoàn tiền ${ret.code}`,
          createdBy: profileId,
          shiftId: currentShift?.id ?? null,
        });
      }

      let debtDelta = 0;
      if (totals.debtAmount > 0) {
        const [supplier] = await tx
          .select({ currentDebt: suppliers.currentDebt })
          .from(suppliers)
          .where(and(eq(suppliers.storeId, gate.storeId), eq(suppliers.id, v.supplierId)))
          .limit(1)
          .for("update");
        debtDelta = -Math.min(
          Number(supplier?.currentDebt ?? 0),
          totals.debtAmount,
        );
        await tx.update(suppliers).set({
          currentDebt: sql`greatest(${suppliers.currentDebt} - ${toMoney(totals.debtAmount)}, 0)`,
        }).where(and(eq(suppliers.storeId, gate.storeId), eq(suppliers.id, v.supplierId)));
      }

      const debtNotification = await createDebtChangedEventInTx(tx, {
        storeId: gate.storeId,
        entityType: "supplier",
        entityId: v.supplierId,
        operationType: "purchase_return",
        operationId: previous ? `${ret.id}:${randomUUID()}` : ret.id,
        delta: debtDelta,
        actorId: profileId,
      });

      await recordActivity(tx, {
        storeId: gate.storeId, actorId: profileId, action: previous ? "purchase_return.updated" : "purchase_return.created", entityType: "purchase_return", entityId: ret.id,
        before: previous ? { code: previous.code, total: previous.totalRefund } : undefined,
        after: { code: ret.code, status: "completed", total: totals.total, refundAmount: totals.refundAmount, debtAmount: totals.debtAmount, itemCount: v.items.length },
        affectedRecords: v.items.map((item) => ({ type: "product", id: item.productId, code: productsById.get(item.productId)?.sku, name: productsById.get(item.productId)?.name, quantity: item.quantity, unitCost: item.returnUnitCost })),
        metadata: { appliedDebtAmount: -debtDelta, purchaseReturnCode: ret.code, supplierId: v.supplierId, warehouseId: v.warehouseId, purchaseId: v.purchaseOrderId },
      });
      return { ret, debtNotification, reversedNotification: previous?.debtNotification };
    });

    if (result.reversedNotification?.created) await publishCommittedNotification(result.reversedNotification.eventId);
    if (result.debtNotification?.created) {
      await publishCommittedNotification(result.debtNotification.eventId);
    }
    revalidatePurchaseReturnPaths(result.ret.id);
    return { ok: true, data: result.ret };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      RETURN_NOT_FOUND: "errors.notFound",
      INVALID_STATE: "errors.invalidData",
      PRODUCT_NOT_FOUND: "errors.invalidData",
      INSUFFICIENT_STOCK: "purchaseReturns.errors.insufficientStock",
      INSUFFICIENT_BATCH_STOCK: "purchaseReturns.errors.insufficientStock",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createPurchaseReturn failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}


type ReturnTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Reverse the posted document while holding its lock; the caller updates or deletes it in the same transaction. */
async function reversePurchaseReturn(tx: ReturnTx, storeId: string, id: string, profileId: string | null, shiftId: string | null) {
  const [ret] = await tx.select().from(purchaseReturns).where(and(eq(purchaseReturns.storeId, storeId), eq(purchaseReturns.id, id))).limit(1).for("update");
  if (!ret) throw new Error("RETURN_NOT_FOUND");
  if (!["completed", "draft"].includes(ret.status)) throw new Error("INVALID_STATE");
  if (ret.status === "draft") return { ...ret, debtNotification: null };
  const items = await tx.select().from(purchaseReturnItems).where(and(eq(purchaseReturnItems.storeId, storeId), eq(purchaseReturnItems.purchaseReturnId, id)));
  await reverseDocumentStockLots(tx, { storeId, refType: "purchase_return", refId: id, createdBy: profileId });
  for (const item of items) {
    const quantity = Number(item.quantity) * Number(item.unitMultiplier);
    await tx.insert(stockLevels).values({ storeId, productId: item.productId, warehouseId: ret.warehouseId, quantity: toQty(quantity) }).onConflictDoUpdate({
      target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
      set: { quantity: sql`${stockLevels.quantity} + ${toQty(quantity)}`, updatedAt: sql`now()` },
    });
    await tx.insert(stockMovements).values({ storeId, productId: item.productId, warehouseId: ret.warehouseId, type: "return_in", quantity: toQty(quantity), unitCost: null, refType: "purchase_return_reversal", refId: id, note: `Đảo phiếu ${ret.code}`, createdBy: profileId });
  }
  // New documents retain the actual (possibly clamped) debt reduction in the audit record.
  // Older documents recorded it in the original debt notification.
  const [audit] = await tx.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.storeId, storeId), eq(auditLogs.entityId, id), inArray(auditLogs.action, ["purchase_return.created", "purchase_return.updated"]))).orderBy(desc(auditLogs.createdAt)).limit(1);
  const recorded = audit?.metadata?.appliedDebtAmount;
  let appliedDebt = typeof recorded === "number" ? recorded : 0;
  if (recorded == null && Number(ret.debtAmount) > 0) {
    const [event] = await tx.select({ metadata: notificationEvents.metadata }).from(notificationEvents).where(and(eq(notificationEvents.storeId, storeId), eq(notificationEvents.eventKey, `debt-changed:supplier:${ret.supplierId}:purchase_return:${id}`))).limit(1);
    // Native creation with no event applied zero; imported history uses its recorded settlement.
    appliedDebt = event ? Math.max(0, -Number(event.metadata.delta ?? 0)) : audit ? 0 : Number(ret.debtAmount);
  }
  if (appliedDebt > 0) await tx.update(suppliers).set({ currentDebt: sql`${suppliers.currentDebt} + ${toMoney(appliedDebt)}` }).where(and(eq(suppliers.storeId, storeId), eq(suppliers.id, ret.supplierId)));
  await recordCashTx(tx, { storeId, type: "out", fund: ret.refundMethod === "bank_transfer" ? "bank" : "cash", amount: Number(ret.refundAmount), category: "supplier_payment", refType: "purchase_return_reversal", refId: id, note: `Đảo tiền hoàn ${ret.code}`, createdBy: profileId, shiftId });
  const debtNotification = await createDebtChangedEventInTx(tx, { storeId, entityType: "supplier", entityId: ret.supplierId, operationType: "purchase_return_reversal", operationId: `${id}:${randomUUID()}`, delta: appliedDebt, actorId: profileId });
  return { ...ret, debtNotification };
}

export async function deletePurchaseReturn(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    const profileId = await getProfileId(gate.userId);
    const shift = profileId ? await getCurrentShift(gate.storeId, profileId) : null;
    const result = await db.transaction(async (tx) => {
      const previous = await reversePurchaseReturn(tx, gate.storeId, id, profileId, shift?.id ?? null);
      await tx.delete(purchaseReturnItems).where(and(eq(purchaseReturnItems.storeId, gate.storeId), eq(purchaseReturnItems.purchaseReturnId, id)));
      await tx.delete(purchaseReturns).where(and(eq(purchaseReturns.storeId, gate.storeId), eq(purchaseReturns.id, id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: profileId, action: "purchase_return.deleted", entityType: "purchase_return", entityId: id, before: { code: previous.code, total: previous.totalRefund, status: previous.status }, metadata: { supplierId: previous.supplierId, warehouseId: previous.warehouseId } });
      return previous;
    });
    if (result.debtNotification?.created) await publishCommittedNotification(result.debtNotification.eventId);
    revalidatePurchaseReturnPaths(id);
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.message === "RETURN_NOT_FOUND") return { ok: false, error: "errors.notFound" };
    console.error("deletePurchaseReturn failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

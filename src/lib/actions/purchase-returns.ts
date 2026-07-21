"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
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
import { type ActionResult, generateCode, getProfileId, requireStockAccess, toMoney, toQty } from "./common";
import { getCurrentShift } from "@/lib/data/shifts";
import { consumeTrackedStockLots } from "@/lib/inventory/stock-lot-service";

export async function searchPurchaseReturnProducts(q: string, warehouseId: string): Promise<PurchaseReturnProductRow[]> {
  const gate = await requireStockAccess();
  if (!gate.ok) return [];
  return searchPurchaseReturnProductRows(q, warehouseId);
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

export async function createPurchaseReturn(
  input: CreatePurchaseReturnOutput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  const parsed = createPurchaseReturnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const totals = calcTotals(v);

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

    const result = await db.transaction(async (tx) => {
      const ids = v.items.map((item) => item.productId);
      const productRows = await tx
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          baseUnit: products.baseUnit,
        })
        .from(products)
        .where(inArray(products.id, ids));
      if (productRows.length !== new Set(ids).size) throw new Error("PRODUCT_NOT_FOUND");
      const productsById = new Map(productRows.map((product) => [product.id, product]));

      const stockRows = await tx
        .select({
          productId: stockLevels.productId,
          quantity: stockLevels.quantity,
        })
        .from(stockLevels)
        .where(and(eq(stockLevels.warehouseId, v.warehouseId), inArray(stockLevels.productId, ids)));
      const stockByProduct = new Map(stockRows.map((row) => [row.productId, Number(row.quantity)]));
      for (const item of v.items) {
        const available = stockByProduct.get(item.productId) ?? 0;
        if (item.quantity > available + 1e-9) throw new Error("INSUFFICIENT_STOCK");
      }

      const [ret] = await tx.insert(purchaseReturns).values({
        code: generateCode("THN"),
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
        createdBy: profileId,
      }).returning({ id: purchaseReturns.id, code: purchaseReturns.code });

      await tx.insert(purchaseReturnItems).values(v.items.map((item) => {
        const product = productsById.get(item.productId)!;
        return {
          purchaseReturnId: ret.id,
          purchaseOrderItemId: null,
          productId: item.productId,
          productName: product.name,
          sku: product.sku,
          unitName: product.baseUnit,
          quantity: toQty(item.quantity),
          unitCost: toMoney(item.unitCost),
          returnUnitCost: toMoney(item.returnUnitCost),
          total: toMoney(lineTotal(item)),
        };
      }));

      for (const item of v.items) {
        await consumeTrackedStockLots(tx, {
          productId: item.productId,
          warehouseId: v.warehouseId,
          quantity: item.quantity,
          refType: "purchase_return",
          refId: ret.id,
          createdBy: profileId,
        });
        await tx.update(stockLevels).set({
          quantity: sql`${stockLevels.quantity} - ${toQty(item.quantity)}`,
          updatedAt: sql`now()`,
        }).where(and(eq(stockLevels.productId, item.productId), eq(stockLevels.warehouseId, v.warehouseId)));

        await tx.insert(stockMovements).values({
          productId: item.productId,
          warehouseId: v.warehouseId,
          type: "return_out",
          quantity: toQty(-item.quantity),
          unitCost: toMoney(item.returnUnitCost),
          refType: "purchase_return",
          refId: ret.id,
          note: ret.code,
          createdBy: profileId,
        });
      }

      if (totals.refundAmount > 0) {
        await recordCashTx(tx, {
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

      if (totals.debtAmount > 0) {
        await tx.update(suppliers).set({
          currentDebt: sql`greatest(${suppliers.currentDebt} - ${toMoney(totals.debtAmount)}, 0)`,
        }).where(eq(suppliers.id, v.supplierId));
      }

      return ret;
    });

    revalidatePurchaseReturnPaths(result.id);
    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      PRODUCT_NOT_FOUND: "errors.invalidData",
      INSUFFICIENT_STOCK: "purchaseReturns.errors.insufficientStock",
      INSUFFICIENT_BATCH_STOCK: "purchaseReturns.errors.insufficientStock",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createPurchaseReturn failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

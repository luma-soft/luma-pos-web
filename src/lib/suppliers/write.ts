import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  products,
  purchaseOrders,
  purchaseReturns,
  supplierPayableEntries,
  supplierPayableReceipts,
  suppliers,
} from "@/db/schema";
import type { ActionResult } from "@/lib/actions/common";
import { recordActivity } from "@/lib/audit/activity-log";

export async function deleteSupplierCore(
  storeId: string,
  actorId: string,
  supplierId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    return await db.transaction(async (tx) => {
      const [supplier] = await tx.select({
        id: suppliers.id,
        code: suppliers.code,
        name: suppliers.name,
        currentDebt: suppliers.currentDebt,
      })
        .from(suppliers)
        .where(and(eq(suppliers.storeId, storeId), eq(suppliers.id, supplierId)))
        .limit(1)
        .for("update");

      if (!supplier) return { ok: false, error: "errors.notFound" };
      if (Number(supplier.currentDebt) !== 0) {
        return { ok: false, error: "suppliers.errors.outstandingDebt" };
      }

      const [purchase] = await tx.select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.storeId, storeId), eq(purchaseOrders.supplierId, supplierId)))
        .limit(1);
      const [purchaseReturn] = await tx.select({ id: purchaseReturns.id })
        .from(purchaseReturns)
        .where(and(eq(purchaseReturns.storeId, storeId), eq(purchaseReturns.supplierId, supplierId)))
        .limit(1);
      const [payment] = await tx.select({ id: supplierPayableReceipts.id })
        .from(supplierPayableReceipts)
        .where(and(eq(supplierPayableReceipts.storeId, storeId), eq(supplierPayableReceipts.supplierId, supplierId)))
        .limit(1);
      const [adjustment] = await tx.select({ id: supplierPayableEntries.id })
        .from(supplierPayableEntries)
        .where(and(eq(supplierPayableEntries.storeId, storeId), eq(supplierPayableEntries.supplierId, supplierId)))
        .limit(1);

      if (purchase || purchaseReturn || payment || adjustment) {
        return { ok: false, error: "suppliers.errors.hasTransactions" };
      }

      await tx.update(products)
        .set({ supplierId: null })
        .where(and(eq(products.storeId, storeId), eq(products.supplierId, supplierId)));

      await recordActivity(tx, {
        storeId,
        actorId,
        action: "supplier.deleted",
        entityType: "supplier",
        entityId: supplier.id,
        before: { code: supplier.code, name: supplier.name },
      });

      await tx.delete(suppliers)
        .where(and(eq(suppliers.storeId, storeId), eq(suppliers.id, supplierId)));

      return { ok: true, data: { id: supplier.id } };
    });
  } catch (error) {
    console.error("deleteSupplierCore failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

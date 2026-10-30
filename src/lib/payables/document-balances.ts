import { and, eq, inArray } from "drizzle-orm";
import { purchaseReturns, supplierPayableEntries } from "@/db/schema";
import { reconcileDebtDocuments } from "@/lib/debt-reconciliation";

// Drizzle's database and transaction objects share the same select API here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type SupplierInvoice = {
  id: string;
  createdAt: Date;
  total: string | number;
  amountPaid: string | number;
};

const money = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;

export async function getEffectiveSupplierInvoices<T extends SupplierInvoice>(
  database: DbLike,
  input: { storeId: string; supplierId: string; currentDebt: number },
  purchases: T[],
) {
  if (purchases.length === 0) return [] as Array<T & { remaining: number }>;
  const purchaseOrderIds = purchases.map((purchase) => purchase.id);
  const [entries, debtReturns] = await Promise.all([
    database.select({ purchaseOrderId: supplierPayableEntries.purchaseOrderId, amount: supplierPayableEntries.amount })
      .from(supplierPayableEntries)
      .where(and(
        eq(supplierPayableEntries.storeId, input.storeId),
        eq(supplierPayableEntries.supplierId, input.supplierId),
        inArray(supplierPayableEntries.purchaseOrderId, purchaseOrderIds),
      )),
    database.select({ purchaseOrderId: purchaseReturns.purchaseOrderId, amount: purchaseReturns.debtAmount })
      .from(purchaseReturns)
      .where(and(
        eq(purchaseReturns.storeId, input.storeId),
        eq(purchaseReturns.supplierId, input.supplierId),
        eq(purchaseReturns.status, "completed"),
        inArray(purchaseReturns.purchaseOrderId, purchaseOrderIds),
      )),
  ]);

  const linkedAdjustments = new Map<string, number>();
  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.purchaseOrderId) {
      linkedAdjustments.set(entry.purchaseOrderId, money((linkedAdjustments.get(entry.purchaseOrderId) ?? 0) + amount));
    }
  }
  const returnedDebtByPurchase = new Map<string, number>();
  for (const debtReturn of debtReturns) {
    if (debtReturn.purchaseOrderId) {
      returnedDebtByPurchase.set(
        debtReturn.purchaseOrderId,
        money((returnedDebtByPurchase.get(debtReturn.purchaseOrderId) ?? 0) + Number(debtReturn.amount)),
      );
    }
  }

  const balances = purchases.map((purchase) => ({
    ...purchase,
    remaining: money(Math.max(
      0,
      Number(purchase.total) - Number(purchase.amountPaid) +
        (linkedAdjustments.get(purchase.id) ?? 0) - (returnedDebtByPurchase.get(purchase.id) ?? 0),
    )),
  }));
  return reconcileDebtDocuments(balances, input.currentDebt);
}

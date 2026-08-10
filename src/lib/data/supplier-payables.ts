import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  purchaseOrders,
  purchaseReturns,
  supplierPayableAllocations,
  supplierPayableEntries,
  supplierPayableReceipts,
  suppliers,
} from "@/db/schema";

export type SupplierPayableLedgerRow = {
  id: string;
  kind: "purchase" | "return" | "payment" | "adjustment";
  code: string;
  purchaseOrderId: string | null;
  createdAt: Date;
  typeLabel: string;
  value: number;
  balance: number;
  reason: string | null;
};

type PayableEvent = Omit<SupplierPayableLedgerRow, "balance"> & { sort: number };

export async function getSupplierPayableOverview(storeId: string, supplierId: string, database: typeof db = db) {
  const [supplier] = await database
    .select({ id: suppliers.id, currentDebt: suppliers.currentDebt })
    .from(suppliers)
    .where(and(eq(suppliers.storeId, storeId), eq(suppliers.id, supplierId)))
    .limit(1);
  if (!supplier) return null;

  const [purchases, returns, receipts, entries] = await Promise.all([
    database
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        status: purchaseOrders.status,
        total: purchaseOrders.total,
        amountPaid: purchaseOrders.amountPaid,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .where(and(
        eq(purchaseOrders.supplierId, supplierId),
        eq(purchaseOrders.storeId, storeId),
        sql`${purchaseOrders.status} in ('received', 'returned')`,
      ))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(100),
    database
      .select({
        id: purchaseReturns.id,
        code: purchaseReturns.code,
        purchaseOrderId: purchaseReturns.purchaseOrderId,
        debtAmount: purchaseReturns.debtAmount,
        createdAt: purchaseReturns.createdAt,
      })
      .from(purchaseReturns)
      .where(and(
        eq(purchaseReturns.supplierId, supplierId),
        eq(purchaseReturns.storeId, storeId),
        eq(purchaseReturns.status, "completed"),
        sql`${purchaseReturns.debtAmount} > 0`,
      ))
      .orderBy(desc(purchaseReturns.createdAt))
      .limit(100),
    database
      .select({
        id: supplierPayableReceipts.id,
        code: supplierPayableReceipts.code,
        amount: supplierPayableReceipts.amount,
        method: supplierPayableReceipts.method,
        reference: supplierPayableReceipts.reference,
        note: supplierPayableReceipts.note,
        createdAt: supplierPayableReceipts.createdAt,
      })
      .from(supplierPayableReceipts)
      .where(and(
        eq(supplierPayableReceipts.supplierId, supplierId),
        eq(supplierPayableReceipts.storeId, storeId),
        eq(supplierPayableReceipts.status, "confirmed"),
      ))
      .orderBy(desc(supplierPayableReceipts.createdAt))
      .limit(100),
    database
      .select({
        id: supplierPayableEntries.id,
        code: supplierPayableEntries.code,
        purchaseOrderId: supplierPayableEntries.purchaseOrderId,
        type: supplierPayableEntries.type,
        amount: supplierPayableEntries.amount,
        reason: supplierPayableEntries.reason,
        reference: supplierPayableEntries.reference,
        note: supplierPayableEntries.note,
        createdAt: supplierPayableEntries.createdAt,
      })
      .from(supplierPayableEntries)
      .where(and(eq(supplierPayableEntries.storeId, storeId), eq(supplierPayableEntries.supplierId, supplierId)))
      .orderBy(desc(supplierPayableEntries.createdAt))
      .limit(100),
  ]);
  const allocatedPaymentRows = purchases.length === 0 ? [] : await database
    .select({
      purchaseOrderId: supplierPayableAllocations.purchaseOrderId,
      amount: sql<string>`coalesce(sum(${supplierPayableAllocations.amount}), 0)`,
    })
    .from(supplierPayableAllocations)
    .where(and(
      eq(supplierPayableAllocations.storeId, storeId),
      inArray(supplierPayableAllocations.purchaseOrderId, purchases.map((purchase) => purchase.id)),
    ))
    .groupBy(supplierPayableAllocations.purchaseOrderId);
  const allocatedPayments = new Map(
    allocatedPaymentRows.map((row) => [row.purchaseOrderId, Number(row.amount)]),
  );

  const events: PayableEvent[] = [];
  for (const purchase of purchases) {
    const total = Number(purchase.total);
    const paid = Number(purchase.amountPaid);
    const explicitPaid = allocatedPayments.get(purchase.id) ?? 0;
    const legacyPaid = Math.max(0, paid - explicitPaid);
    events.push({
      id: purchase.id,
      kind: "purchase",
      code: purchase.code,
      purchaseOrderId: purchase.id,
      createdAt: purchase.createdAt,
      typeLabel: "Nhập hàng",
      value: total,
      reason: null,
      sort: 10,
    });
    if (legacyPaid > 0) {
      events.push({
        id: `legacy-payment:${purchase.id}`,
        kind: "payment",
        code: `TT-${purchase.code}`,
        purchaseOrderId: purchase.id,
        createdAt: purchase.createdAt,
        typeLabel: "Thanh toán",
        value: -legacyPaid,
        reason: "Thanh toán khi nhập hàng",
        sort: 20,
      });
    }
  }
  for (const purchaseReturn of returns) {
    events.push({
      id: purchaseReturn.id,
      kind: "return",
      code: purchaseReturn.code,
      purchaseOrderId: purchaseReturn.purchaseOrderId,
      createdAt: purchaseReturn.createdAt,
      typeLabel: "Trả hàng",
      value: -Number(purchaseReturn.debtAmount),
      reason: null,
      sort: 30,
    });
  }
  for (const receipt of receipts) {
    events.push({
      id: receipt.id,
      kind: "payment",
      code: receipt.code,
      purchaseOrderId: null,
      createdAt: receipt.createdAt,
      typeLabel: "Thanh toán",
      value: -Number(receipt.amount),
      reason: receipt.note || receipt.reference,
      sort: 20,
    });
  }
  for (const entry of entries) {
    events.push({
      id: entry.id,
      kind: "adjustment",
      code: entry.code,
      purchaseOrderId: entry.purchaseOrderId,
      createdAt: entry.createdAt,
      typeLabel: "Điều chỉnh công nợ",
      value: Number(entry.amount),
      reason: entry.reason,
      sort: 40,
    });
  }

  events.sort((a, b) => {
    const byDate = b.createdAt.getTime() - a.createdAt.getTime();
    return byDate || b.sort - a.sort || b.code.localeCompare(a.code) || b.id.localeCompare(a.id);
  });
  let balance = Number(supplier.currentDebt);
  const ledger = events.map((event) => {
    const row: SupplierPayableLedgerRow = {
      id: event.id,
      kind: event.kind,
      code: event.code,
      purchaseOrderId: event.purchaseOrderId,
      createdAt: event.createdAt,
      typeLabel: event.typeLabel,
      value: event.value,
      balance,
      reason: event.reason,
    };
    balance -= event.value;
    return row;
  });

  return {
    supplierId: supplier.id,
    currentDebt: Number(supplier.currentDebt),
    lastReconciledAt: ledger[0]?.createdAt ?? null,
    invoices: purchases
      .map((purchase) => ({
        id: purchase.id,
        code: purchase.code,
        createdAt: purchase.createdAt,
        total: Number(purchase.total),
        amountPaid: Number(purchase.amountPaid),
        remaining: Math.max(0, Number(purchase.total) - Number(purchase.amountPaid)),
      }))
      .filter((purchase) => purchase.remaining > 0),
    receipts: receipts.map((receipt) => ({ ...receipt, amount: Number(receipt.amount) })),
    entries: entries.map((entry) => ({ ...entry, amount: Number(entry.amount) })),
    ledger,
  };
}

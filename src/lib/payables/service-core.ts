import { eq, inArray, sql } from "drizzle-orm";
import {
  auditLogs,
  purchaseOrders,
  supplierPayableAllocations,
  supplierPayableEntries,
  supplierPayableReceipts,
  suppliers,
} from "@/db/schema";
import { generateCode } from "@/lib/actions/common";
import { fundForMethod, recordCashTx } from "@/lib/cash";
import { createDebtChangedEventInTx } from "@/lib/notifications/events-core";

// Drizzle Postgres and PGlite expose the same runtime transaction API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type Actor = {
  profileId: string | null;
  shiftId: string | null;
  source?: "manual" | "mobile";
};
type SupplierPaymentMethod = "cash" | "bank_transfer";

export type SupplierPayableAllocationInput = {
  purchaseOrderId: string;
  amount: number;
};

export type PaySupplierInput = {
  supplierId: string;
  amount: number;
  method: SupplierPaymentMethod;
  allocations: SupplierPayableAllocationInput[];
  clientRequestId: string;
  reference?: string;
  note?: string;
};

export type SupplierPayableEntryInput = {
  supplierId: string;
  purchaseOrderId?: string;
  amount: number;
  reason: string;
  clientRequestId: string;
  reference?: string;
  note?: string;
};

export type PayableResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function money(value: number) {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

function validRequestId(value: string) {
  return value.trim().length >= 8 && value.trim().length <= 80;
}

function knownError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const errors: Record<string, string> = {
    SUPPLIER_NOT_FOUND: "errors.notFound",
    INVALID_INPUT: "errors.invalidData",
    PAYMENT_CONFLICT: "payments.errors.referenceConflict",
    PURCHASE_NOT_PAYABLE: "purchases.errors.notPayable",
    PURCHASE_NOT_SUPPLIER: "errors.invalidData",
    ALLOCATION_EXCEEDS_REMAINING: "orders.errors.amountExceedsRemaining",
    DEBT_EXCEEDS_CURRENT: "orders.errors.amountExceedsRemaining",
  };
  return errors[message] ?? "errors.serverError";
}

/** Pay a supplier and allocate the payment to purchase receipts atomically. */
export async function paySupplierPayable(
  database: DbLike,
  input: PaySupplierInput,
  actor: Actor,
): Promise<PayableResult<{ receiptId: string; replayed: boolean; notificationEventId?: string }>> {
  const amount = money(input.amount);
  const allocations = input.allocations.map((row) => ({
    ...row,
    amount: money(row.amount),
  }));
  const allocationTotal = money(allocations.reduce((sum, row) => sum + row.amount, 0));
  const ids = allocations.map((row) => row.purchaseOrderId);
  if (
    !input.supplierId || !validRequestId(input.clientRequestId) || amount <= 0 ||
    !["cash", "bank_transfer"].includes(input.method) ||
    new Set(ids).size !== ids.length ||
    allocations.some((row) => !row.purchaseOrderId || row.amount <= 0) ||
    allocationTotal - amount > 1e-9
  ) {
    return { ok: false, error: "errors.invalidData" };
  }

  try {
    return await database.transaction(async (tx: DbLike) => {
      const [supplier] = await tx
        .select({ id: suppliers.id, currentDebt: suppliers.currentDebt })
        .from(suppliers)
        .where(eq(suppliers.id, input.supplierId))
        .limit(1)
        .for("update");
      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const [existing] = await tx
        .select({
          id: supplierPayableReceipts.id,
          supplierId: supplierPayableReceipts.supplierId,
          amount: supplierPayableReceipts.amount,
          method: supplierPayableReceipts.method,
          reference: supplierPayableReceipts.reference,
          note: supplierPayableReceipts.note,
        })
        .from(supplierPayableReceipts)
        .where(eq(supplierPayableReceipts.clientRequestId, input.clientRequestId.trim()))
        .limit(1)
        .for("update");
      if (existing) {
        const existingAllocations = await tx
          .select({
            purchaseOrderId: supplierPayableAllocations.purchaseOrderId,
            amount: supplierPayableAllocations.amount,
          })
          .from(supplierPayableAllocations)
          .where(eq(supplierPayableAllocations.receiptId, existing.id));
        const allocationMatches = existingAllocations.length === allocations.length &&
          existingAllocations.every((row: { purchaseOrderId: string; amount: string }) => {
            const requested = allocations.find(
              (allocation) => allocation.purchaseOrderId === row.purchaseOrderId,
            );
            return requested && Math.abs(Number(row.amount) - requested.amount) <= 1e-9;
          });
        if (
          existing.supplierId !== input.supplierId ||
          Math.abs(Number(existing.amount) - amount) > 1e-9 ||
          existing.method !== input.method ||
          existing.reference !== (input.reference?.trim() || null) ||
          existing.note !== (input.note?.trim() || null) ||
          !allocationMatches
        ) throw new Error("PAYMENT_CONFLICT");
        return { ok: true as const, data: { receiptId: existing.id, replayed: true } };
      }

      if (amount > Number(supplier.currentDebt) + 1e-9) {
        throw new Error("DEBT_EXCEEDS_CURRENT");
      }

      const purchaseRows = await tx
        .select()
        .from(purchaseOrders)
        .where(inArray(purchaseOrders.id, ids))
        .for("update");
      if (purchaseRows.length !== ids.length) throw new Error("PURCHASE_NOT_PAYABLE");
      const purchases = new Map<string, typeof purchaseOrders.$inferSelect>(
        purchaseRows.map((purchase: typeof purchaseOrders.$inferSelect) => [purchase.id, purchase]),
      );
      for (const allocation of allocations) {
        const purchase = purchases.get(allocation.purchaseOrderId);
        if (!purchase || purchase.supplierId !== input.supplierId) {
          throw new Error("PURCHASE_NOT_SUPPLIER");
        }
        if (!["received", "returned"].includes(purchase.status)) {
          throw new Error("PURCHASE_NOT_PAYABLE");
        }
        const remaining = money(Number(purchase.total) - Number(purchase.amountPaid));
        if (allocation.amount > remaining + 1e-9) {
          throw new Error("ALLOCATION_EXCEEDS_REMAINING");
        }
      }

      const [receipt] = await tx
        .insert(supplierPayableReceipts)
        .values({
          code: generateCode("PCN"),
          supplierId: input.supplierId,
          amount: amount.toFixed(2),
          method: input.method,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          clientRequestId: input.clientRequestId.trim(),
          createdBy: actor.profileId,
          confirmedAt: new Date(),
        })
        .returning({ id: supplierPayableReceipts.id });

      if (allocations.length > 0) {
        await tx.insert(supplierPayableAllocations).values(
          allocations.map((allocation) => ({
            receiptId: receipt.id,
            purchaseOrderId: allocation.purchaseOrderId,
            amount: allocation.amount.toFixed(2),
          })),
        );
      }
      for (const allocation of allocations) {
        const purchase = purchases.get(allocation.purchaseOrderId)!;
        await tx
          .update(purchaseOrders)
          .set({ amountPaid: money(Number(purchase.amountPaid) + allocation.amount).toFixed(2) })
          .where(eq(purchaseOrders.id, purchase.id));
      }

      await recordCashTx(tx, {
        type: "out",
        fund: fundForMethod(input.method),
        amount,
        category: "supplier_payment",
        refType: "supplier_payable_receipt",
        refId: receipt.id,
        note: `Thanh toán nhà cung cấp ${input.reference?.trim() || receipt.id}`,
        createdBy: actor.profileId,
        shiftId: actor.shiftId,
      });
      await tx
        .update(suppliers)
        .set({ currentDebt: sql`${suppliers.currentDebt} - ${amount.toFixed(2)}` })
        .where(eq(suppliers.id, input.supplierId));
      await tx.insert(auditLogs).values({
        actorId: actor.profileId,
        source: actor.source ?? "manual",
        action: "supplier_payable.payment.create",
        entityType: "supplier_payable_receipt",
        entityId: receipt.id,
        before: { supplierId: input.supplierId, currentDebt: Number(supplier.currentDebt) },
        after: {
          supplierId: input.supplierId,
          currentDebt: money(Number(supplier.currentDebt) - amount),
          amount,
          method: input.method,
        },
        affectedRecords: [
          { entityType: "supplier", entityId: input.supplierId },
          ...allocations.map((allocation) => ({
            entityType: "purchase_order",
            entityId: allocation.purchaseOrderId,
          })),
        ],
        metadata: {
          clientRequestId: input.clientRequestId.trim(),
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
        },
      });
      const notification = await createDebtChangedEventInTx(tx, {
        entityType: "supplier",
        entityId: input.supplierId,
        operationType: "supplier_payment",
        operationId: receipt.id,
        delta: -amount,
        actorId: actor.profileId,
      });
      return {
        ok: true as const,
        data: {
          receiptId: receipt.id,
          replayed: false,
          ...(notification?.created ? { notificationEventId: notification.eventId } : {}),
        },
      };
    });
  } catch (error) {
    return { ok: false, error: knownError(error) };
  }
}

/** Manager-approved supplier debt adjustment; no cashbook movement is created. */
export async function createSupplierPayableEntry(
  database: DbLike,
  input: SupplierPayableEntryInput,
  actor: Actor,
): Promise<PayableResult<{ entryId: string; replayed: boolean; notificationEventId?: string }>> {
  const amount = money(input.amount);
  if (
    !input.supplierId || !validRequestId(input.clientRequestId) ||
    !input.reason.trim() || amount === 0
  ) return { ok: false, error: "errors.invalidData" };

  try {
    return await database.transaction(async (tx: DbLike) => {
      const [supplier] = await tx
        .select({ id: suppliers.id, currentDebt: suppliers.currentDebt })
        .from(suppliers)
        .where(eq(suppliers.id, input.supplierId))
        .limit(1)
        .for("update");
      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const [existing] = await tx
        .select({
          id: supplierPayableEntries.id,
          supplierId: supplierPayableEntries.supplierId,
          amount: supplierPayableEntries.amount,
          reason: supplierPayableEntries.reason,
          purchaseOrderId: supplierPayableEntries.purchaseOrderId,
          reference: supplierPayableEntries.reference,
          note: supplierPayableEntries.note,
        })
        .from(supplierPayableEntries)
        .where(eq(supplierPayableEntries.clientRequestId, input.clientRequestId.trim()))
        .limit(1)
        .for("update");
      if (existing) {
        if (
          existing.supplierId !== input.supplierId ||
          Math.abs(Number(existing.amount) - amount) > 1e-9 ||
          existing.reason !== input.reason.trim() ||
          existing.purchaseOrderId !== (input.purchaseOrderId || null) ||
          existing.reference !== (input.reference?.trim() || null) ||
          existing.note !== (input.note?.trim() || null)
        ) throw new Error("PAYMENT_CONFLICT");
        return { ok: true as const, data: { entryId: existing.id, replayed: true } };
      }

      if (amount < 0 && Math.abs(amount) > Number(supplier.currentDebt) + 1e-9) {
        throw new Error("DEBT_EXCEEDS_CURRENT");
      }
      if (input.purchaseOrderId) {
        const [purchase] = await tx
          .select({ supplierId: purchaseOrders.supplierId })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.purchaseOrderId))
          .limit(1)
          .for("update");
        if (!purchase || purchase.supplierId !== input.supplierId) {
          throw new Error("PURCHASE_NOT_SUPPLIER");
        }
      }

      const type = amount > 0 ? "adjustment_debit" : "adjustment_credit";
      const [entry] = await tx
        .insert(supplierPayableEntries)
        .values({
          code: generateCode("DCN"),
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId || null,
          type,
          amount: amount.toFixed(2),
          reason: input.reason.trim(),
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          clientRequestId: input.clientRequestId.trim(),
          createdBy: actor.profileId,
          approvedBy: actor.profileId,
        })
        .returning({ id: supplierPayableEntries.id });
      await tx
        .update(suppliers)
        .set({ currentDebt: sql`${suppliers.currentDebt} + ${amount.toFixed(2)}` })
        .where(eq(suppliers.id, input.supplierId));
      await tx.insert(auditLogs).values({
        actorId: actor.profileId,
        source: actor.source ?? "manual",
        action: "supplier_payable.adjustment.create",
        entityType: "supplier_payable_entry",
        entityId: entry.id,
        before: { supplierId: input.supplierId, currentDebt: Number(supplier.currentDebt) },
        after: {
          supplierId: input.supplierId,
          currentDebt: money(Number(supplier.currentDebt) + amount),
          amount,
          reason: input.reason.trim(),
        },
        affectedRecords: [
          { entityType: "supplier", entityId: input.supplierId },
          ...(input.purchaseOrderId
            ? [{ entityType: "purchase_order", entityId: input.purchaseOrderId }]
            : []),
        ],
        metadata: {
          clientRequestId: input.clientRequestId.trim(),
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
        },
      });
      const notification = await createDebtChangedEventInTx(tx, {
        entityType: "supplier",
        entityId: input.supplierId,
        operationType: type,
        operationId: entry.id,
        delta: amount,
        actorId: actor.profileId,
      });
      return {
        ok: true as const,
        data: {
          entryId: entry.id,
          replayed: false,
          ...(notification?.created ? { notificationEventId: notification.eventId } : {}),
        },
      };
    });
  } catch (error) {
    return { ok: false, error: knownError(error) };
  }
}

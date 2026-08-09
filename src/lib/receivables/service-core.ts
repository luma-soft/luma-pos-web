import { eq, inArray, sql } from "drizzle-orm";
import {
  customerReceivableAllocations,
  customerReceivableEntries,
  customerReceivableReceipts,
  customers,
  orders,
  payments,
} from "@/db/schema";
import { generateCode } from "@/lib/actions/common";
import { fundForMethod, recordCashTx } from "@/lib/cash";
import { createDebtChangedEventInTx } from "@/lib/notifications/events-core";

// Drizzle Postgres and PGlite expose the same runtime transaction API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type Actor = { profileId: string | null; shiftId: string | null };
type PaymentMethod = "cash" | "bank_transfer" | "card";

export type ReceivableAllocationInput = { orderId: string; amount: number };
export type CollectReceivableInput = {
  customerId: string;
  amount: number;
  method: PaymentMethod;
  allocations: ReceivableAllocationInput[];
  clientRequestId: string;
  reference?: string;
  note?: string;
};

export type ReceivableEntryInput = {
  customerId: string;
  orderId?: string;
  amount: number;
  type: "adjustment_debit" | "adjustment_credit" | "settlement_discount";
  reason: string;
  clientRequestId: string;
  reference?: string;
  note?: string;
};

export type ReceivableResult<T> = { ok: true; data: T } | { ok: false; error: string };

function money(value: number) {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

function validRequestId(value: string) {
  return value.trim().length >= 8 && value.trim().length <= 80;
}

function knownError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const errors: Record<string, string> = {
    CUSTOMER_NOT_FOUND: "errors.notFound",
    INVALID_INPUT: "errors.invalidData",
    RECEIPT_CONFLICT: "payments.errors.referenceConflict",
    ORDER_NOT_PAYABLE: "orders.errors.notPayable",
    ORDER_NOT_CUSTOMER: "errors.invalidData",
    ALLOCATION_EXCEEDS_REMAINING: "orders.errors.amountExceedsRemaining",
    DEBT_EXCEEDS_CURRENT: "orders.errors.amountExceedsRemaining",
  };
  return errors[message] ?? "errors.serverError";
}

/**
 * Collect one customer receipt and allocate it to one or more invoices atomically.
 * The cashbook receives exactly one entry, while each invoice still gets a payment
 * record for its own paid/partial state and downstream reports.
 */
export async function collectCustomerReceivable(
  database: DbLike,
  input: CollectReceivableInput,
  actor: Actor,
): Promise<ReceivableResult<{ receiptId: string; replayed: boolean; notificationEventId?: string }>> {
  const amount = money(input.amount);
  const allocations = input.allocations.map((row) => ({ ...row, amount: money(row.amount) }));
  const allocationTotal = money(allocations.reduce((sum, row) => sum + row.amount, 0));
  const ids = allocations.map((row) => row.orderId);
  if (
    !input.customerId || !validRequestId(input.clientRequestId) || amount <= 0 ||
    !["cash", "bank_transfer", "card"].includes(input.method) ||
    new Set(ids).size !== ids.length ||
    allocations.some((row) => !row.orderId || row.amount <= 0) ||
    allocationTotal - amount > 1e-9
  ) return { ok: false, error: "errors.invalidData" };

  try {
    return await database.transaction(async (tx: DbLike) => {
      const [customer] = await tx.select({ id: customers.id, currentDebt: customers.currentDebt })
        .from(customers).where(eq(customers.id, input.customerId)).limit(1).for("update");
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const [existing] = await tx.select({ id: customerReceivableReceipts.id, customerId: customerReceivableReceipts.customerId, amount: customerReceivableReceipts.amount })
        .from(customerReceivableReceipts)
        .where(eq(customerReceivableReceipts.clientRequestId, input.clientRequestId.trim()))
        .limit(1).for("update");
      if (existing) {
        if (existing.customerId !== input.customerId || Math.abs(Number(existing.amount) - amount) > 1e-9) throw new Error("RECEIPT_CONFLICT");
        return { ok: true as const, data: { receiptId: existing.id, replayed: true } };
      }

      const invoiceRows = await tx.select().from(orders).where(inArray(orders.id, ids)).for("update");
      if (invoiceRows.length !== ids.length) throw new Error("ORDER_NOT_PAYABLE");
      const invoices = new Map<string, typeof orders.$inferSelect>(
        invoiceRows.map((order: typeof orders.$inferSelect) => [order.id, order]),
      );
      for (const allocation of allocations) {
        const order = invoices.get(allocation.orderId);
        if (!order || order.customerId !== input.customerId) throw new Error("ORDER_NOT_CUSTOMER");
        if (order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_NOT_PAYABLE");
        if (allocation.amount > money(Number(order.total) - Number(order.amountPaid)) + 1e-9) {
          throw new Error("ALLOCATION_EXCEEDS_REMAINING");
        }
      }

      const [receipt] = await tx.insert(customerReceivableReceipts).values({
        code: generateCode("PTN"), customerId: input.customerId, amount: amount.toFixed(2),
        method: input.method, reference: input.reference?.trim() || null, note: input.note?.trim() || null,
        clientRequestId: input.clientRequestId.trim(), createdBy: actor.profileId, confirmedAt: new Date(),
      }).returning({ id: customerReceivableReceipts.id });

      const allocationRows = [] as Array<typeof customerReceivableAllocations.$inferInsert>;
      for (let index = 0; index < allocations.length; index += 1) {
        const allocation = allocations[index];
        const order = invoices.get(allocation.orderId)!;
        const newPaid = money(Number(order.amountPaid) + allocation.amount);
        const [payment] = await tx.insert(payments).values({
          orderId: order.id, shiftId: actor.shiftId, amount: allocation.amount.toFixed(2), method: input.method,
          status: "manual_confirmed", clientRequestId: `${input.clientRequestId.trim()}:${index}`,
          reference: input.reference?.trim() || null, note: input.note?.trim() || null, createdBy: actor.profileId,
        }).returning({ id: payments.id });
        await tx.update(orders).set({
          amountPaid: newPaid.toFixed(2), paymentStatus: newPaid >= Number(order.total) - 1e-9 ? "paid" : "partial",
          updatedAt: sql`now()`,
        }).where(eq(orders.id, order.id));
        allocationRows.push({ receiptId: receipt.id, orderId: order.id, paymentId: payment.id, amount: allocation.amount.toFixed(2) });
      }
      if (allocationRows.length > 0) {
        await tx.insert(customerReceivableAllocations).values(allocationRows);
      }
      await recordCashTx(tx, {
        type: "in", fund: fundForMethod(input.method), amount, category: "debt_collect",
        refType: "customer_receivable_receipt", refId: receipt.id,
        note: `Thu nợ khách hàng ${input.reference?.trim() || receipt.id}`,
        createdBy: actor.profileId, shiftId: actor.shiftId,
      });
      await tx.update(customers).set({ currentDebt: sql`${customers.currentDebt} - ${amount.toFixed(2)}` })
        .where(eq(customers.id, input.customerId));
      const notification = await createDebtChangedEventInTx(tx, {
        entityType: "customer", entityId: input.customerId, operationType: "receivable_collection",
        operationId: receipt.id, delta: -amount, actorId: actor.profileId,
      });
      return { ok: true as const, data: { receiptId: receipt.id, replayed: false, ...(notification?.created ? { notificationEventId: notification.eventId } : {}) } };
    });
  } catch (error) {
    return { ok: false, error: knownError(error) };
  }
}

/** Manager-approved non-cash debt movement (adjustment or settlement discount). */
export async function createCustomerReceivableEntry(
  database: DbLike,
  input: ReceivableEntryInput,
  actor: Actor,
): Promise<ReceivableResult<{ entryId: string; replayed: boolean; notificationEventId?: string }>> {
  const amount = money(input.amount);
  if (!input.customerId || !validRequestId(input.clientRequestId) || !input.reason.trim() || amount === 0 ||
    !["adjustment_debit", "adjustment_credit", "settlement_discount"].includes(input.type) ||
    (input.type === "adjustment_debit" && amount < 0) || (input.type !== "adjustment_debit" && amount > 0)) {
    return { ok: false, error: "errors.invalidData" };
  }
  try {
    return await database.transaction(async (tx: DbLike) => {
      const [customer] = await tx.select({ id: customers.id, currentDebt: customers.currentDebt })
        .from(customers).where(eq(customers.id, input.customerId)).limit(1).for("update");
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      const [existing] = await tx.select({ id: customerReceivableEntries.id, customerId: customerReceivableEntries.customerId, amount: customerReceivableEntries.amount })
        .from(customerReceivableEntries).where(eq(customerReceivableEntries.clientRequestId, input.clientRequestId.trim())).limit(1);
      if (existing) {
        if (existing.customerId !== input.customerId || Math.abs(Number(existing.amount) - amount) > 1e-9) throw new Error("RECEIPT_CONFLICT");
        return { ok: true as const, data: { entryId: existing.id, replayed: true } };
      }
      const [entry] = await tx.insert(customerReceivableEntries).values({
        code: generateCode(input.type === "settlement_discount" ? "CKTT" : "DCN"), customerId: input.customerId,
        orderId: input.orderId || null, type: input.type, amount: amount.toFixed(2), reason: input.reason.trim(),
        reference: input.reference?.trim() || null, note: input.note?.trim() || null,
        clientRequestId: input.clientRequestId.trim(), createdBy: actor.profileId, approvedBy: actor.profileId,
      }).returning({ id: customerReceivableEntries.id });
      await tx.update(customers).set({ currentDebt: sql`${customers.currentDebt} + ${amount.toFixed(2)}` })
        .where(eq(customers.id, input.customerId));
      const notification = await createDebtChangedEventInTx(tx, {
        entityType: "customer", entityId: input.customerId, operationType: input.type,
        operationId: entry.id, delta: amount, actorId: actor.profileId,
      });
      return { ok: true as const, data: { entryId: entry.id, replayed: false, ...(notification?.created ? { notificationEventId: notification.eventId } : {}) } };
    });
  } catch (error) {
    return { ok: false, error: knownError(error) };
  }
}

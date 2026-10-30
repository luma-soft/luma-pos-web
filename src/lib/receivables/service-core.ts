import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  customerReceivableAllocations,
  customerReceivableEntries,
  customerReceivableReceipts,
  cashTransactions,
  customers,
  orders,
  payments,
  paymentBankAccounts,
  returns,
} from "@/db/schema";
import { generateCode } from "@/lib/actions/common";
import { fundForMethod, recordCashTx } from "@/lib/cash";
import { getEffectiveCustomerInvoices } from "@/lib/receivables/document-balances";
import { createDebtChangedEventInTx } from "@/lib/notifications/events-core";
import { recordActivity } from "@/lib/audit/activity-log";
import { reverseCashTransaction } from "@/lib/cashbook/reversals";

// Drizzle Postgres and PGlite expose the same runtime transaction API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type Actor = { storeId: string; profileId: string | null; shiftId: string | null };
type PaymentMethod = "cash" | "bank_transfer";

export type ReceivableAllocationInput = { orderId: string; amount: number };
export type CollectReceivableInput = {
  customerId: string;
  amount: number;
  method: PaymentMethod;
  bankAccountId?: string | null;
  occurredAt?: string;
  allocations: ReceivableAllocationInput[];
  clientRequestId: string;
  reference?: string;
  note?: string;
};

export type ReceivableEntryInput = {
  customerId: string;
  orderId?: string;
  /** Legacy delta semantics. Prefer targetDebt for adjustments. */
  amount?: number;
  targetDebt?: number;
  type: "adjustment_debit" | "adjustment_credit" | "settlement_discount";
  reason?: string;
  occurredAt?: string;
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
    RECEIPT_NOT_CANCELLABLE: "financialVoucherCancellation.errors.notCancellable",
    RECEIPT_CASH_TRANSACTION_NOT_FOUND: "financialVoucherCancellation.errors.cashTransactionMissing",
    CASH_TRANSACTION_ALREADY_CANCELLED: "financialVoucherCancellation.errors.alreadyCancelled",
    INVALID_INPUT: "errors.invalidData",
    RECEIPT_CONFLICT: "payments.errors.referenceConflict",
    ORDER_NOT_PAYABLE: "orders.errors.notPayable",
    ORDER_NOT_CUSTOMER: "errors.invalidData",
    ALLOCATION_EXCEEDS_REMAINING: "orders.errors.amountExceedsRemaining",
    DEBT_EXCEEDS_CURRENT: "orders.errors.amountExceedsRemaining",
  };
  return errors[message] ?? "errors.serverError";
}

function safeDatabaseFailureFields(error: unknown) {
  let current: unknown = error;
  const seen = new Set<object>();
  const fields: Record<string, string> = {};

  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    if (!fields.errorType && typeof candidate.name === "string" && /^[A-Za-z0-9_]+$/.test(candidate.name)) {
      fields.errorType = candidate.name;
    }
    if (!fields.sqlState && typeof candidate.code === "string" && /^[0-9A-Z]{5}$/i.test(candidate.code)) {
      fields.sqlState = candidate.code.toUpperCase();
    }
    for (const key of ["constraint", "table", "column"] as const) {
      const value = candidate[key];
      if (!fields[key] && typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value)) {
        fields[key] = value;
      }
    }
    current = candidate.cause;
  }

  return fields;
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
  const requestedAllocations = input.allocations.map((row) => ({ ...row, amount: money(row.amount) }));
  const allocationTotal = money(requestedAllocations.reduce((sum, row) => sum + row.amount, 0));
  const ids = requestedAllocations.map((row) => row.orderId);
  const rawBankAccountId = typeof input.bankAccountId === "string" ? input.bankAccountId.trim() : "";
  const bankAccountId = input.method === "bank_transfer" ? rawBankAccountId || null : null;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (
    !input.customerId || !validRequestId(input.clientRequestId) || amount <= 0 ||
    !["cash", "bank_transfer"].includes(input.method) ||
    !Number.isFinite(occurredAt.getTime()) ||
    (input.method === "bank_transfer" && !bankAccountId) ||
    (input.method === "cash" && rawBankAccountId.length > 0) ||
    new Set(ids).size !== ids.length ||
    requestedAllocations.some((row) => !row.orderId || row.amount <= 0) ||
    allocationTotal - amount > 1e-9
  ) return { ok: false, error: "errors.invalidData" };

  let phase = "begin_transaction";
  try {
    return await database.transaction(async (tx: DbLike) => {
      phase = "lock_customer";
      const [customer] = await tx.select({ id: customers.id, code: customers.code, name: customers.name, currentDebt: customers.currentDebt })
        .from(customers).where(and(eq(customers.storeId, actor.storeId), eq(customers.id, input.customerId))).limit(1).for("update");
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      phase = "check_idempotency";
      const [existing] = await tx.select({
        id: customerReceivableReceipts.id,
        customerId: customerReceivableReceipts.customerId,
        amount: customerReceivableReceipts.amount,
        method: customerReceivableReceipts.method,
        bankAccountId: customerReceivableReceipts.bankAccountId,
        createdAt: customerReceivableReceipts.createdAt,
      })
        .from(customerReceivableReceipts)
        .where(and(eq(customerReceivableReceipts.storeId, actor.storeId), eq(customerReceivableReceipts.clientRequestId, input.clientRequestId.trim())))
        .limit(1).for("update");
      if (existing) {
        if (
          existing.customerId !== input.customerId ||
          Math.abs(Number(existing.amount) - amount) > 1e-9 ||
          existing.method !== input.method ||
          existing.bankAccountId !== bankAccountId ||
          (input.occurredAt != null && existing.createdAt.getTime() !== occurredAt.getTime())
        ) throw new Error("RECEIPT_CONFLICT");
        return { ok: true as const, data: { receiptId: existing.id, replayed: true } };
      }

      phase = "read_bank_account";
      const [bankAccount] = bankAccountId ? await tx
        .select({ id: paymentBankAccounts.id, accountNumber: paymentBankAccounts.accountNumber })
        .from(paymentBankAccounts)
        .where(and(
          eq(paymentBankAccounts.storeId, actor.storeId),
          eq(paymentBankAccounts.id, bankAccountId),
          eq(paymentBankAccounts.enabled, true),
        ))
        .limit(1) : [];
      if (input.method === "bank_transfer" && !bankAccount) throw new Error("INVALID_INPUT");

      // Lock all open invoices, then reconcile their legacy/raw balances to the
      // customer's authoritative net balance before allocating new cash.
      phase = "lock_open_invoices";
      const invoiceRows = await tx
        .select()
        .from(orders)
        .where(and(
          eq(orders.storeId, actor.storeId),
          eq(orders.customerId, input.customerId),
          inArray(orders.status, ["completed", "returned"]),
          sql`${orders.total} > ${orders.amountPaid} or exists (
            select 1 from ${customerReceivableEntries}
            where ${customerReceivableEntries.storeId} = ${actor.storeId}
              and ${customerReceivableEntries.customerId} = ${input.customerId}
              and ${customerReceivableEntries.orderId} = ${orders.id}
              and ${customerReceivableEntries.amount} > 0
          )`,
        ))
        .orderBy(asc(orders.createdAt), asc(orders.id))
        .for("update");
      phase = "reconcile_invoice_balances";
      const effectiveInvoices = await getEffectiveCustomerInvoices(
        tx,
        { storeId: actor.storeId, customerId: input.customerId, currentDebt: Number(customer.currentDebt) },
        invoiceRows,
      );
      const remainingByOrder = new Map(effectiveInvoices.map((invoice) => [invoice.id, invoice.remaining]));
      const invoices = new Map<string, typeof orders.$inferSelect>(
        invoiceRows.map((order: typeof orders.$inferSelect) => [order.id, order]),
      );
      if (ids.some((id) => !invoices.has(id))) throw new Error("ORDER_NOT_PAYABLE");
      for (const allocation of requestedAllocations) {
        const order = invoices.get(allocation.orderId);
        if (!order || order.customerId !== input.customerId) throw new Error("ORDER_NOT_CUSTOMER");
        if (order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_NOT_PAYABLE");
        if (allocation.amount > (remainingByOrder.get(order.id) ?? 0) + 1e-9) {
          throw new Error("ALLOCATION_EXCEEDS_REMAINING");
        }
      }

      const allocations = requestedAllocations.map((row) => ({ ...row }));
      const allocationsByOrder = new Map(
        allocations.map((allocation) => [allocation.orderId, allocation]),
      );
      let unallocated = money(amount - allocationTotal);
      for (const order of invoiceRows) {
        if (unallocated <= 0) break;
        const explicit = allocationsByOrder.get(order.id);
        const available = money(
          (remainingByOrder.get(order.id) ?? 0) - (explicit?.amount ?? 0),
        );
        const automaticAmount = money(Math.min(unallocated, Math.max(0, available)));
        if (automaticAmount <= 0) continue;
        if (explicit) explicit.amount = money(explicit.amount + automaticAmount);
        else {
          const automatic = { orderId: order.id, amount: automaticAmount };
          allocations.push(automatic);
          allocationsByOrder.set(order.id, automatic);
        }
        unallocated = money(unallocated - automaticAmount);
      }

      phase = "insert_receipt";
      const [receipt] = await tx.insert(customerReceivableReceipts).values({
        storeId: actor.storeId,
        code: generateCode("PTN"), customerId: input.customerId, amount: amount.toFixed(2),
        method: input.method, bankAccountId, reference: input.reference?.trim() || null, note: input.note?.trim() || null,
        clientRequestId: input.clientRequestId.trim(), createdBy: actor.profileId, confirmedAt: occurredAt, createdAt: occurredAt,
      }).returning({ id: customerReceivableReceipts.id, code: customerReceivableReceipts.code });

      const allocationRows = [] as Array<typeof customerReceivableAllocations.$inferInsert>;
      for (let index = 0; index < allocations.length; index += 1) {
        const allocation = allocations[index];
        const order = invoices.get(allocation.orderId)!;
        const newPaid = money(Number(order.amountPaid) + allocation.amount);
        const effectivelySettled = money((remainingByOrder.get(order.id) ?? 0) - allocation.amount) <= 0;
        phase = "insert_invoice_payment";
        const [payment] = await tx.insert(payments).values({
          storeId: actor.storeId,
          orderId: order.id, shiftId: actor.shiftId, amount: allocation.amount.toFixed(2), method: input.method,
          bankAccountId,
          accountNumber: bankAccount?.accountNumber ?? null,
          status: "manual_confirmed", clientRequestId: `${input.clientRequestId.trim()}:${index}`,
          reference: input.reference?.trim() || null, note: input.note?.trim() || null, createdBy: actor.profileId,
          confirmedAt: occurredAt, createdAt: occurredAt,
        }).returning({ id: payments.id });
        phase = "update_invoice_payment_state";
        await tx.update(orders).set({
          amountPaid: newPaid.toFixed(2),
          paymentStatus: newPaid >= Number(order.total) - 1e-9 || effectivelySettled ? "paid" : "partial",
          updatedAt: sql`now()`,
        }).where(and(eq(orders.storeId, actor.storeId), eq(orders.id, order.id)));
        allocationRows.push({ storeId: actor.storeId, receiptId: receipt.id, orderId: order.id, paymentId: payment.id, amount: allocation.amount.toFixed(2) });
      }
      if (allocationRows.length > 0) {
        phase = "insert_invoice_allocations";
        await tx.insert(customerReceivableAllocations).values(allocationRows);
      }
      phase = "record_cash_transaction";
      await recordCashTx(tx, {
        storeId: actor.storeId,
        type: "in", fund: fundForMethod(input.method), amount, category: "debt_collect",
        refType: "customer_receivable_receipt", refId: receipt.id,
        note: `Thu nợ khách hàng ${input.reference?.trim() || receipt.id}`,
        createdBy: actor.profileId, shiftId: actor.shiftId,
        createdAt: occurredAt,
      });
      phase = "update_customer_balance";
      await tx.update(customers).set({ currentDebt: sql`${customers.currentDebt} - ${amount.toFixed(2)}` })
        .where(and(eq(customers.storeId, actor.storeId), eq(customers.id, input.customerId)));
      phase = "record_activity";
      await recordActivity(tx, {
        storeId: actor.storeId, actorId: actor.profileId,
        action: "customer.receivable.collected", entityType: "customer_receivable_receipt", entityId: receipt.id,
        before: { currentDebt: Number(customer.currentDebt) },
        after: { code: receipt.code, customerName: customer.name, amount, method: input.method, bankAccountId, occurredAt: occurredAt.toISOString(), currentDebt: money(Number(customer.currentDebt) - amount) },
        affectedRecords: [
          { type: "customer", id: customer.id, code: customer.code, name: customer.name },
          ...allocations.map((allocation) => ({ type: "order", id: allocation.orderId, code: invoices.get(allocation.orderId)!.code })),
        ],
      });
      phase = "create_debt_notification";
      const notification = await createDebtChangedEventInTx(tx, {
        storeId: actor.storeId,
        entityType: "customer", entityId: input.customerId, operationType: "receivable_collection",
        operationId: receipt.id, delta: -amount, actorId: actor.profileId,
      });
      phase = "commit_transaction";
      return { ok: true as const, data: { receiptId: receipt.id, replayed: false, ...(notification?.created ? { notificationEventId: notification.eventId } : {}) } };
    });
  } catch (error) {
    const mappedError = knownError(error);
    if (mappedError === "errors.serverError") {
      console.error("Customer receivable collection failed", {
        phase,
        ...safeDatabaseFailureFields(error),
      });
    }
    return { ok: false, error: mappedError };
  }
}

export type CancelCustomerReceivableInput = {
  receiptId: string;
  customerId?: string;
  reason: string;
};

/** Cancel a confirmed customer receipt and reverse its debt, allocations, and cash movement atomically. */
export async function cancelCustomerReceivableReceipt(
  database: DbLike,
  input: CancelCustomerReceivableInput,
  actor: Actor,
): Promise<ReceivableResult<{ receiptId: string; replayed: boolean; notificationEventId?: string }>> {
  const reason = input.reason?.trim() ?? "";
  if (!input.receiptId || reason.length < 3 || reason.length > 500) {
    return { ok: false, error: "errors.invalidData" };
  }

  try {
    return await database.transaction(async (tx: DbLike) => {
      const [receiptOwner] = await tx
        .select({ customerId: customerReceivableReceipts.customerId })
        .from(customerReceivableReceipts)
        .where(and(
          eq(customerReceivableReceipts.storeId, actor.storeId),
          eq(customerReceivableReceipts.id, input.receiptId),
        ))
        .limit(1);
      if (!receiptOwner || (input.customerId && receiptOwner.customerId !== input.customerId)) {
        throw new Error("CUSTOMER_NOT_FOUND");
      }

      const [customer] = await tx
        .select({ id: customers.id, code: customers.code, name: customers.name, currentDebt: customers.currentDebt })
        .from(customers)
        .where(and(eq(customers.storeId, actor.storeId), eq(customers.id, receiptOwner.customerId)))
        .limit(1)
        .for("update");
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      const [receipt] = await tx
        .select()
        .from(customerReceivableReceipts)
        .where(and(
          eq(customerReceivableReceipts.storeId, actor.storeId),
          eq(customerReceivableReceipts.id, input.receiptId),
          eq(customerReceivableReceipts.customerId, customer.id),
        ))
        .limit(1)
        .for("update");
      if (!receipt) throw new Error("CUSTOMER_NOT_FOUND");
      if (receipt.status === "cancelled") {
        return { ok: true as const, data: { receiptId: receipt.id, replayed: true } };
      }
      if (receipt.status !== "confirmed") throw new Error("RECEIPT_NOT_CANCELLABLE");

      const allocations = await tx
        .select({ orderId: customerReceivableAllocations.orderId, paymentId: customerReceivableAllocations.paymentId, amount: customerReceivableAllocations.amount })
        .from(customerReceivableAllocations)
        .where(and(
          eq(customerReceivableAllocations.storeId, actor.storeId),
          eq(customerReceivableAllocations.receiptId, receipt.id),
        ))
        .orderBy(asc(customerReceivableAllocations.orderId))
        .for("update");
      const orderIds: string[] = [...new Set<string>(allocations.map((allocation: { orderId: string }) => allocation.orderId))].sort();
      const orderRows = orderIds.length > 0
        ? await tx
          .select()
          .from(orders)
          .where(and(eq(orders.storeId, actor.storeId), inArray(orders.id, orderIds)))
          .orderBy(asc(orders.id))
          .for("update")
        : [];
      const ordersById = new Map<string, typeof orders.$inferSelect>(
        orderRows.map((order: typeof orders.$inferSelect) => [order.id, order]),
      );
      if (orderIds.some((id) => !ordersById.has(id))) throw new Error("CUSTOMER_NOT_FOUND");

      const paymentIds = allocations
        .map((allocation: { paymentId: string | null }) => allocation.paymentId)
        .filter((id: string | null): id is string => Boolean(id));
      if (paymentIds.length > 0) {
        await tx.update(payments)
          .set({ status: "cancelled" })
          .where(and(eq(payments.storeId, actor.storeId), inArray(payments.id, paymentIds)));
      }

      const [adjustmentRows, returnRows] = orderIds.length > 0
        ? await Promise.all([
          tx.select({ orderId: customerReceivableEntries.orderId, amount: customerReceivableEntries.amount })
            .from(customerReceivableEntries)
            .where(and(
              eq(customerReceivableEntries.storeId, actor.storeId),
              eq(customerReceivableEntries.customerId, customer.id),
              inArray(customerReceivableEntries.orderId, orderIds),
            )),
          tx.select({ orderId: returns.orderId, amount: returns.totalRefund })
            .from(returns)
            .where(and(
              eq(returns.storeId, actor.storeId),
              eq(returns.customerId, customer.id),
              eq(returns.status, "completed"),
              eq(returns.refundMethod, "debt_deduct"),
              inArray(returns.orderId, orderIds),
            )),
        ])
        : [[], []];
      const adjustmentsByOrder = new Map<string, number>();
      for (const row of adjustmentRows) {
        if (row.orderId) adjustmentsByOrder.set(row.orderId, money((adjustmentsByOrder.get(row.orderId) ?? 0) + Number(row.amount)));
      }
      const returnsByOrder = new Map<string, number>();
      for (const row of returnRows) {
        if (row.orderId) returnsByOrder.set(row.orderId, money((returnsByOrder.get(row.orderId) ?? 0) + Number(row.amount)));
      }

      const allocationsByOrder = new Map<string, number>();
      for (const allocation of allocations) {
        allocationsByOrder.set(
          allocation.orderId,
          money((allocationsByOrder.get(allocation.orderId) ?? 0) + Number(allocation.amount)),
        );
      }
      for (const [orderId, allocatedAmount] of allocationsByOrder) {
        const order = ordersById.get(orderId)!;
        const newPaid = money(Math.max(0, Number(order.amountPaid) - allocatedAmount));
        const remaining = money(Math.max(
          0,
          Number(order.total) - newPaid + (adjustmentsByOrder.get(orderId) ?? 0) - (returnsByOrder.get(orderId) ?? 0),
        ));
        await tx.update(orders).set({
          amountPaid: newPaid.toFixed(2),
          paymentStatus: remaining <= 0 ? "paid" : newPaid > 0 ? "partial" : "unpaid",
          updatedAt: sql`now()`,
        }).where(and(eq(orders.storeId, actor.storeId), eq(orders.id, orderId)));
      }

      const occurredAt = new Date();
      const cashRows = await tx
        .select()
        .from(cashTransactions)
        .where(and(
          eq(cashTransactions.storeId, actor.storeId),
          eq(cashTransactions.refType, "customer_receivable_receipt"),
          eq(cashTransactions.refId, receipt.id),
        ))
        .limit(2)
        .for("update");
      if (cashRows.length > 1) throw new Error("RECEIPT_CASH_TRANSACTION_CONFLICT");
      if (cashRows.length !== 1) throw new Error("RECEIPT_CASH_TRANSACTION_NOT_FOUND");
      if (cashRows[0]) {
        await reverseCashTransaction(tx, {
          transaction: cashRows[0],
          actorId: actor.profileId,
          shiftId: actor.shiftId,
          reason,
          referenceType: "customer_receivable_receipt_cancellation",
          referenceId: receipt.id,
          reversedAt: occurredAt,
        });
      }

      await tx.update(customerReceivableReceipts).set({
        status: "cancelled",
        cancelledAt: occurredAt,
        cancelledBy: actor.profileId,
        cancellationReason: reason,
      }).where(and(
        eq(customerReceivableReceipts.storeId, actor.storeId),
        eq(customerReceivableReceipts.id, receipt.id),
      ));
      const newDebt = money(Number(customer.currentDebt) + Number(receipt.amount));
      await tx.update(customers)
        .set({ currentDebt: newDebt.toFixed(2) })
        .where(and(eq(customers.storeId, actor.storeId), eq(customers.id, customer.id)));

      await recordActivity(tx, {
        storeId: actor.storeId,
        actorId: actor.profileId,
        action: "customer.receivable.receipt.cancelled",
        entityType: "customer_receivable_receipt",
        entityId: receipt.id,
        before: { code: receipt.code, status: receipt.status, currentDebt: Number(customer.currentDebt) },
        after: { code: receipt.code, status: "cancelled", amount: Number(receipt.amount), currentDebt: newDebt, reason, cancelledAt: occurredAt },
        affectedRecords: [
          { type: "customer", id: customer.id, code: customer.code, name: customer.name },
          ...orderIds.map((id) => ({ type: "order", id, code: ordersById.get(id)!.code })),
        ],
      });
      const notification = await createDebtChangedEventInTx(tx, {
        storeId: actor.storeId,
        entityType: "customer",
        entityId: customer.id,
        operationType: "receivable_collection_cancelled",
        operationId: receipt.id,
        delta: Number(receipt.amount),
        actorId: actor.profileId,
      });
      return {
        ok: true as const,
        data: { receiptId: receipt.id, replayed: false, ...(notification?.created ? { notificationEventId: notification.eventId } : {}) },
      };
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
  const requestedAmount = input.amount == null ? Number.NaN : money(input.amount);
  const targetDebt = input.targetDebt == null ? null : money(input.targetDebt);
  const reason = input.reason?.trim() ?? "";
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (!input.customerId || !validRequestId(input.clientRequestId) ||
    !Number.isFinite(occurredAt.getTime()) ||
    (input.type === "settlement_discount" && !reason) ||
    (targetDebt == null && (!Number.isFinite(requestedAmount) || requestedAmount === 0)) ||
    (targetDebt != null && !Number.isFinite(targetDebt)) ||
    !["adjustment_debit", "adjustment_credit", "settlement_discount"].includes(input.type) ||
    (targetDebt == null && input.type === "adjustment_debit" && requestedAmount < 0) ||
    (targetDebt == null && input.type !== "adjustment_debit" && requestedAmount > 0)) {
    return { ok: false, error: "errors.invalidData" };
  }
  try {
    return await database.transaction(async (tx: DbLike) => {
      const [customer] = await tx.select({ id: customers.id, code: customers.code, name: customers.name, currentDebt: customers.currentDebt })
        .from(customers).where(and(eq(customers.storeId, actor.storeId), eq(customers.id, input.customerId))).limit(1).for("update");
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      const amount = targetDebt == null
        ? requestedAmount
        : money(targetDebt - Number(customer.currentDebt));
      if (!Number.isFinite(amount) || amount === 0) return { ok: false, error: "errors.invalidData" };
      const entryType = targetDebt == null
        ? input.type
        : amount > 0 ? "adjustment_debit" : "adjustment_credit";
      const [existing] = await tx.select({
        id: customerReceivableEntries.id,
        customerId: customerReceivableEntries.customerId,
        amount: customerReceivableEntries.amount,
        createdAt: customerReceivableEntries.createdAt,
      })
        .from(customerReceivableEntries).where(and(eq(customerReceivableEntries.storeId, actor.storeId), eq(customerReceivableEntries.clientRequestId, input.clientRequestId.trim()))).limit(1);
      if (existing) {
        if (existing.customerId !== input.customerId || Math.abs(Number(existing.amount) - amount) > 1e-9 ||
          (input.occurredAt != null && existing.createdAt.getTime() !== occurredAt.getTime())) throw new Error("RECEIPT_CONFLICT");
        return { ok: true as const, data: { entryId: existing.id, replayed: true } };
      }
      if (input.orderId) {
        const [order] = await tx.select({ customerId: orders.customerId, status: orders.status })
          .from(orders)
          .where(and(eq(orders.storeId, actor.storeId), eq(orders.id, input.orderId)))
          .limit(1)
          .for("update");
        if (!order || order.customerId !== input.customerId) throw new Error("ORDER_NOT_CUSTOMER");
        if (order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_NOT_PAYABLE");
      }
      const [entry] = await tx.insert(customerReceivableEntries).values({
        storeId: actor.storeId,
        code: generateCode(entryType === "settlement_discount" ? "CKTT" : "DCN"), customerId: input.customerId,
        orderId: input.orderId || null, type: entryType, amount: amount.toFixed(2), reason,
        reference: input.reference?.trim() || null, note: input.note?.trim() || null,
        clientRequestId: input.clientRequestId.trim(), createdBy: actor.profileId, approvedBy: actor.profileId,
        createdAt: occurredAt,
      }).returning({ id: customerReceivableEntries.id, code: customerReceivableEntries.code });
      await tx.update(customers).set({ currentDebt: sql`${customers.currentDebt} + ${amount.toFixed(2)}` })
        .where(and(eq(customers.storeId, actor.storeId), eq(customers.id, input.customerId)));
      await recordActivity(tx, {
        storeId: actor.storeId, actorId: actor.profileId,
        action: "customer.receivable.adjusted", entityType: "customer_receivable_entry", entityId: entry.id,
        before: { currentDebt: Number(customer.currentDebt) },
        after: { code: entry.code, customerName: customer.name, amount, targetDebt: targetDebt ?? undefined, type: entryType, reason: reason || undefined, occurredAt: occurredAt.toISOString(), currentDebt: money(Number(customer.currentDebt) + amount) },
        affectedRecords: [{ type: "customer", id: customer.id, code: customer.code, name: customer.name }],
      });
      const notification = await createDebtChangedEventInTx(tx, {
        storeId: actor.storeId,
        entityType: "customer", entityId: input.customerId, operationType: entryType,
        operationId: entry.id, delta: amount, actorId: actor.profileId,
      });
      return { ok: true as const, data: { entryId: entry.id, replayed: false, ...(notification?.created ? { notificationEventId: notification.eventId } : {}) } };
    });
  } catch (error) {
    return { ok: false, error: knownError(error) };
  }
}

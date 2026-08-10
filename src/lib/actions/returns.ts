"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cashTransactions, customers, orderItems, orders, paymentRefunds, payments, productComboItems, products, returnItems, returns, stockLevels, stockMovements,
} from "@/db/schema";
import {
  createPosReturnSchema,
  createExchangeSchema,
  createReturnSchema,
  updateReturnMetadataSchema,
  type CreateExchangeOutput,
  type CreatePosReturnOutput,
  type CreateReturnOutput,
  type UpdateReturnMetadataInput,
} from "@/lib/schemas/returns";
import {
  type ActionResult,
  requireManager,
  getProfileId,
  generateCode,
  isUniqueViolation,
  toMoney,
  toQty,
} from "./common";
import { recordCashTx, fundForMethod } from "@/lib/cash";
import { Routes } from "@/lib/routes";
import { getCurrentShift } from "@/lib/data/shifts";
import { normalizeOrderItems, type NormalizedOrderItem } from "@/lib/orders/normalize";
import { accentInsensitiveLike } from "@/lib/search";
import { calculateExchangeSettlement } from "@/lib/returns/exchange-settlement";
import {
  returnCancellationBlockReason,
  returnCancellationCustomerDeltas,
  returnCancellationStockTargets,
} from "@/lib/returns/cancellation";
import {
  consumeTrackedStockLots,
  receiveUnspecifiedTrackedStockLot,
  restoreOrReceiveTrackedStockLots,
} from "@/lib/inventory/stock-lot-service";
import type { GatewayProvider } from "@/lib/payments/gateways";
import { gatewayRefundReference } from "@/lib/payments/refund-service";
import {
  createDebtChangedEventInTx,
  createNotificationEventInTx,
} from "@/lib/notifications/events-core";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";

const GATEWAY_REFUND_METHODS = new Set<GatewayProvider>(["momo", "zalopay", "vnpay"]);
const isGatewayRefundMethod = (value: string): value is GatewayProvider =>
  GATEWAY_REFUND_METHODS.has(value as GatewayProvider);

type ReturnTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function stockTargetsForReturnedItem(
  tx: ReturnTransaction,
  storeId: string,
  productId: string,
  baseQuantity: number,
) {
  const [product] = await tx
    .select({ productKind: products.productKind })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.id, productId)))
    .limit(1);
  if (!product || product.productKind === "service") return [];
  if (product.productKind === "product") {
    return [{ productId, quantity: baseQuantity }];
  }
  const components = await tx
    .select({
      productId: productComboItems.componentProductId,
      quantity: productComboItems.quantity,
      productKind: products.productKind,
    })
    .from(productComboItems)
    .innerJoin(products, eq(productComboItems.componentProductId, products.id))
    .where(and(eq(products.storeId, storeId), eq(productComboItems.comboProductId, productId)));
  return components
    .filter((component) => component.productKind === "product")
    .map((component) => ({
      productId: component.productId,
      quantity: Number(component.quantity) * baseQuantity,
    }));
}

async function selectRefundableGatewayPayment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  storeId: string,
  orderId: string,
  provider: GatewayProvider,
  amount: number,
) {
  const candidates = await tx.select().from(payments).where(and(
    eq(payments.storeId, storeId),
    eq(payments.orderId, orderId),
    eq(payments.provider, provider),
    inArray(payments.status, ["confirmed", "reconciled", "manual_confirmed"]),
  )).orderBy(desc(payments.confirmedAt)).for("update");
  for (const payment of candidates) {
    if (!payment.providerTransactionId || !payment.reference) continue;
    const [reserved] = await tx.select({ total: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)` })
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.storeId, storeId), eq(paymentRefunds.paymentId, payment.id), ne(paymentRefunds.status, "failed")));
    if (Number(payment.amount) - Number(reserved?.total ?? 0) >= amount - 1e-9) return payment;
  }
  throw new Error("REFUND_SOURCE_NOT_FOUND");
}

export type ReturnableOrderOption = {
  id: string;
  code: string;
  customerId: string | null;
  customerName: string | null;
  total: string;
  createdAt: Date;
};

export async function searchReturnableOrders(q: string): Promise<ReturnableOrderOption[]> {
  const gate = await requireManager();
  if (!gate.ok) return [];
  const query = q.trim();
  if (!query) return [];
  return db
    .select({
      id: orders.id,
      code: orders.code,
      customerId: orders.customerId,
      customerName: customers.name,
      total: orders.total,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(and(
      eq(orders.storeId, gate.storeId),
      eq(orders.status, "completed"),
      or(
        accentInsensitiveLike(orders.code, query),
        accentInsensitiveLike(customers.name, query),
        accentInsensitiveLike(customers.phone, query),
      ),
    ))
    .orderBy(desc(orders.createdAt))
    .limit(12);
}

export type ExchangeResult = {
  returnId: string;
  returnCode: string;
  exchangeOrderId: string;
  exchangeOrderCode: string;
  difference: number;
  direction: "collect" | "refund" | "even";
  gatewayRefundId?: string;
};

type ExchangeTransactionResult = ExchangeResult & {
  notification: Awaited<ReturnType<typeof createNotificationEventInTx>>;
};

async function exchangeResultForClientId(
  storeId: string,
  clientId: string,
): Promise<ExchangeResult | null> {
  const [row] = await db.select({
    returnId: returns.id,
    returnCode: returns.code,
    exchangeOrderId: orders.id,
    exchangeOrderCode: orders.code,
    difference: returns.exchangeDifference,
    gatewayRefundId: paymentRefunds.id,
  }).from(orders)
    .innerJoin(returns, eq(returns.exchangeOrderId, orders.id))
    .leftJoin(paymentRefunds, eq(paymentRefunds.returnId, returns.id))
    .where(and(eq(orders.storeId, storeId), eq(orders.clientId, clientId)))
    .limit(1);
  if (!row) return null;
  const difference = Number(row.difference ?? 0);
  return {
    returnId: row.returnId,
    returnCode: row.returnCode,
    exchangeOrderId: row.exchangeOrderId,
    exchangeOrderCode: row.exchangeOrderCode,
    difference,
    direction: difference > 1e-9 ? "collect" : difference < -1e-9 ? "refund" : "even",
    ...(row.gatewayRefundId ? { gatewayRefundId: row.gatewayRefundId } : {}),
  };
}

/** Atomic paid-order exchange. Returned merchandise is the credit applied to
 * the replacement order; only the signed price difference touches cash/debt. */
export async function createExchangeForUser(
  userId: string,
  input: CreateExchangeOutput,
): Promise<ActionResult<ExchangeResult>> {
  const parsed = createExchangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const context = await resolveStoreContextForUser(userId);
  if (!context) return { ok: false, error: "errors.unauthorized" };
  const { storeId } = context;

  const existing = await exchangeResultForClientId(storeId, v.clientId);
  if (existing) return { ok: true, data: existing };

  let replacementItems: NormalizedOrderItem[];
  try {
    replacementItems = await normalizeOrderItems(storeId, v.exchangeItems);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "INVALID_ITEMS"].includes(message)) {
      return { ok: false, error: "errors.invalidData" };
    }
    throw error;
  }

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(storeId, profileId) : null;
    const result = await db.transaction(async (tx): Promise<ExchangeTransactionResult> => {
      const [order] = await tx.select().from(orders)
        .where(and(eq(orders.storeId, storeId), eq(orders.id, v.orderId))).limit(1).for("update");
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "completed" && order.status !== "returned") {
        throw new Error("ORDER_CANCELLED");
      }
      if (Number(order.amountPaid) + 1e-9 < Number(order.total)) {
        throw new Error("EXCHANGE_REQUIRES_PAID_ORDER");
      }
      if (!order.warehouseId) throw new Error("WAREHOUSE_REQUIRED");

      const itemIds = v.items.map((item) => item.orderItemId);
      const sourceItems = await tx.select().from(orderItems)
        .where(and(eq(orderItems.storeId, storeId), inArray(orderItems.id, itemIds))).for("update");
      const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
      const previous = await tx.select({
        orderItemId: returnItems.orderItemId,
        qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
      }).from(returnItems)
        .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
        .where(and(eq(returnItems.storeId, storeId), inArray(returnItems.orderItemId, itemIds)))
        .groupBy(returnItems.orderItemId);
      const previousById = new Map(previous.map((item) => [item.orderItemId, Number(item.qty)]));
      const returnedRows: (typeof returnItems.$inferInsert)[] = [];
      let returnTotal = 0;
      for (const item of v.items) {
        const source = sourceById.get(item.orderItemId);
        if (!source || source.orderId !== order.id) throw new Error("ITEM_NOT_IN_ORDER");
        const remaining = Number(source.quantity) - (previousById.get(source.id) ?? 0);
        if (item.quantity > remaining + 1e-9) throw new Error("QTY_EXCEEDS");
        const total = item.quantity * Number(source.unitPrice);
        returnTotal += total;
        returnedRows.push({
          returnId: "",
          orderItemId: source.id,
          productId: source.productId,
          productName: source.productName,
          unitName: source.unitName,
          unitMultiplier: source.unitMultiplier,
          quantity: toQty(item.quantity),
          unitPrice: source.unitPrice,
          total: toMoney(total),
          restock: item.restock,
        });
      }

      const replacementSubtotal = replacementItems.reduce((sum, item) => sum + item.total, 0);
      const settlement = calculateExchangeSettlement({
        returnTotal,
        replacementTotal: replacementSubtotal,
        settlementMethod: v.settlementMethod,
        refundMethod: v.refundMethod,
      });
      returnTotal = settlement.returnTotal;
      const replacementTotal = settlement.replacementTotal;
      const { difference, exchangeCredit, paymentStatus } = settlement;
      const paid = settlement.amountPaid;
      const gatewayPayment = difference < -1e-9 && isGatewayRefundMethod(v.refundMethod)
        ? await selectRefundableGatewayPayment(tx, storeId, order.id, v.refundMethod, -difference)
        : null;
      const gatewayReference = gatewayPayment
        ? gatewayRefundReference(v.refundMethod as GatewayProvider, v.clientId)
        : null;
      if (gatewayPayment && !gatewayReference) throw new Error("REFUND_PROVIDER_NOT_CONFIGURED");

      const replacementProductIds = [...new Set(replacementItems.map((item) => item.productId))];
      const stockRows = replacementProductIds.length === 0
        ? []
        : await tx.select().from(stockLevels)
            .where(and(
              eq(stockLevels.storeId, storeId),
              eq(stockLevels.warehouseId, order.warehouseId),
              inArray(stockLevels.productId, replacementProductIds),
            )).for("update");
      const availableByProduct = new Map(stockRows.map((row) => [row.productId, Number(row.quantity)]));
      for (const returned of returnedRows.filter((row) => row.restock)) {
        availableByProduct.set(
          returned.productId,
          (availableByProduct.get(returned.productId) ?? 0) +
            Number(returned.quantity) * Number(returned.unitMultiplier),
        );
      }
      for (const item of replacementItems) {
        const required = item.quantity * item.unitMultiplier;
        const available = availableByProduct.get(item.productId) ?? 0;
        if (available + 1e-9 < required) throw new Error("INSUFFICIENT_STOCK");
        availableByProduct.set(item.productId, available - required);
      }

      if (difference < -1e-9 && v.refundMethod === "debt_deduct") {
        if (!order.customerId) throw new Error("DEBT_NEEDS_CUSTOMER");
        const [customer] = await tx.select({ debt: customers.currentDebt })
          .from(customers).where(and(eq(customers.storeId, storeId), eq(customers.id, order.customerId))).limit(1).for("update");
        if (!customer || Number(customer.debt) + 1e-9 < -difference) {
          throw new Error("DEBT_TOO_SMALL");
        }
      }

      const [exchangeOrder] = await tx.insert(orders).values({
        storeId,
        code: generateCode("DH"),
        clientId: v.clientId,
        documentType: "sale",
        status: "completed",
        paymentStatus,
        shiftId: currentShift?.id ?? null,
        customerId: order.customerId,
        warehouseId: order.warehouseId,
        subtotal: toMoney(replacementTotal),
        total: toMoney(replacementTotal),
        amountPaid: toMoney(paid),
        sourceOrderId: order.id,
        sourceMode: "exchange",
        note: `Đổi hàng từ ${order.code}${v.note ? ` · ${v.note}` : ""}`,
        createdBy: profileId,
      }).returning({ id: orders.id, code: orders.code });
      await tx.insert(orderItems).values(replacementItems.map((item) => ({
        storeId,
        orderId: exchangeOrder.id,
        productId: item.productId,
        productName: item.productName,
        unitName: item.unitName,
        unitMultiplier: toQty(item.unitMultiplier),
        quantity: toQty(item.quantity),
        unitPrice: toMoney(item.unitPrice),
        total: toMoney(item.total),
      })));

      const [returned] = await tx.insert(returns).values({
        storeId,
        code: generateCode("TH"),
        clientId: v.clientId,
        orderId: order.id,
        customerId: order.customerId,
        warehouseId: order.warehouseId,
        reason: v.reason,
        refundMethod: v.refundMethod,
        totalRefund: toMoney(returnTotal),
        exchangeOrderId: exchangeOrder.id,
        exchangeDifference: toMoney(difference),
        exchangeSettlementMethod: difference > 0 ? v.settlementMethod : v.refundMethod,
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: returns.id, code: returns.code });
      await tx.insert(returnItems).values(returnedRows.map((row) => ({
        ...row,
        storeId,
        returnId: returned.id,
      })));
      const [gatewayRefund] = gatewayPayment && gatewayReference
        ? await tx.insert(paymentRefunds).values({
            storeId,
            returnId: returned.id,
            paymentId: gatewayPayment.id,
            provider: gatewayPayment.provider!,
            reference: gatewayReference,
            clientRequestId: v.clientId,
            amount: toMoney(-difference),
            createdBy: profileId,
          }).returning({ id: paymentRefunds.id })
        : [];

      for (const row of returnedRows.filter((item) => item.restock)) {
        const targets = await stockTargetsForReturnedItem(
          tx,
          storeId,
          row.productId,
          Number(row.quantity) * Number(row.unitMultiplier),
        );
        for (const target of targets) {
          await restoreOrReceiveTrackedStockLots(tx, {
            storeId,
            productId: target.productId,
            warehouseId: order.warehouseId,
            quantity: target.quantity,
            sourceRefType: "order",
            sourceRefId: order.id,
            refType: "exchange_return",
            refId: returned.id,
            fallbackBatchNumber: `RETURN-${returned.code}`,
            createdBy: profileId,
          });
          await tx.insert(stockLevels).values({
            storeId,
            productId: target.productId,
            warehouseId: order.warehouseId,
            quantity: toQty(target.quantity),
          }).onConflictDoUpdate({
            target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} + ${toQty(target.quantity)}`,
              updatedAt: sql`now()`,
            },
          });
          await tx.insert(stockMovements).values({
            storeId,
            productId: target.productId,
            warehouseId: order.warehouseId,
            type: "return_in",
            quantity: toQty(target.quantity),
            refType: "exchange_return",
            refId: returned.id,
            note: `${returned.code} ← ${order.code}`,
            createdBy: profileId,
          });
        }
      }
      for (const item of replacementItems) {
        for (const target of item.stockItems) {
          await consumeTrackedStockLots(tx, {
            storeId,
            productId: target.productId,
            warehouseId: order.warehouseId,
            quantity: target.quantity,
            refType: "exchange_order",
            refId: exchangeOrder.id,
            createdBy: profileId,
          });
          await tx.insert(stockLevels).values({
            storeId,
            productId: target.productId,
            warehouseId: order.warehouseId,
            quantity: toQty(-target.quantity),
          }).onConflictDoUpdate({
            target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} - ${toQty(target.quantity)}`,
              updatedAt: sql`now()`,
            },
          });
          await tx.insert(stockMovements).values({
            storeId,
            productId: target.productId,
            warehouseId: order.warehouseId,
            type: "sale",
            quantity: toQty(-target.quantity),
            refType: "exchange_order",
            refId: exchangeOrder.id,
            note: exchangeOrder.code,
            createdBy: profileId,
          });
        }
      }

      if (exchangeCredit > 0) {
        await tx.insert(payments).values({
          storeId,
          orderId: exchangeOrder.id,
          shiftId: currentShift?.id ?? null,
          amount: toMoney(exchangeCredit),
          method: "exchange_credit",
          reference: returned.code,
          note: `Giá trị hàng đổi ${returned.code}`,
          createdBy: profileId,
        });
      }
      if (difference > 1e-9 && v.settlementMethod !== "credit") {
        await tx.insert(payments).values({
          storeId,
          orderId: exchangeOrder.id,
          shiftId: currentShift?.id ?? null,
          amount: toMoney(difference),
          method: v.settlementMethod,
          note: `Bù chênh lệch đổi hàng ${returned.code}`,
          createdBy: profileId,
        });
        await recordCashTx(tx, {
          storeId,
          type: "in",
          fund: fundForMethod(v.settlementMethod),
          amount: difference,
          category: "sale",
          refType: "exchange_order",
          refId: exchangeOrder.id,
          note: `Bù chênh lệch ${exchangeOrder.code}`,
          createdBy: profileId,
          shiftId: currentShift?.id ?? null,
        });
      } else if (
        difference < -1e-9 &&
        v.refundMethod !== "debt_deduct" &&
        !isGatewayRefundMethod(v.refundMethod)
      ) {
        await recordCashTx(tx, {
          storeId,
          type: "out",
          fund: fundForMethod(v.refundMethod),
          amount: -difference,
          category: "refund",
          refType: "exchange_return",
          refId: returned.id,
          note: `Hoàn chênh lệch ${returned.code}`,
          createdBy: profileId,
          shiftId: currentShift?.id ?? null,
        });
      }

      if (order.customerId) {
        await tx.update(customers).set({
          currentDebt: sql`greatest(${customers.currentDebt} + ${toMoney(settlement.debtDelta)}, 0)`,
          totalSpent: sql`greatest(${customers.totalSpent} - ${toMoney(returnTotal)} + ${toMoney(replacementTotal)}, 0)`,
        }).where(and(eq(customers.storeId, storeId), eq(customers.id, order.customerId)));
      }

      const allItems = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, order.id)));
      const allReturned = await tx.select({
        orderItemId: returnItems.orderItemId,
        qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
      }).from(returnItems)
        .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
        .innerJoin(orderItems, eq(returnItems.orderItemId, orderItems.id))
        .where(and(eq(returnItems.storeId, storeId), eq(orderItems.storeId, storeId), eq(orderItems.orderId, order.id)))
        .groupBy(returnItems.orderItemId);
      const returnedByItem = new Map(allReturned.map((item) => [item.orderItemId, Number(item.qty)]));
      if (allItems.every((item) => (returnedByItem.get(item.id) ?? 0) >= Number(item.quantity) - 1e-9)) {
        await tx.update(orders).set({ status: "returned", updatedAt: sql`now()` })
          .where(and(eq(orders.storeId, storeId), eq(orders.id, order.id)));
      }

      const notification = await createNotificationEventInTx(tx, {
        storeId,
        eventKey: `invoice-created:${exchangeOrder.id}`,
        category: "invoiceCreated",
        entityType: "order",
        entityId: exchangeOrder.id,
        actorId: profileId,
        target: "invoices",
        priority: "normal",
        quietHoursPolicy: "defer",
        excludeActor: true,
        metadata: {
          debtDelta: settlement.debtDelta.toFixed(2),
          source: "exchange",
        },
      });

      return {
        returnId: returned.id,
        returnCode: returned.code,
        exchangeOrderId: exchangeOrder.id,
        exchangeOrderCode: exchangeOrder.code,
        difference,
        direction: settlement.direction,
        ...(gatewayRefund ? { gatewayRefundId: gatewayRefund.id } : {}),
        notification,
      };
    });

    if (result.notification?.created) {
      await publishCommittedNotification(result.notification.eventId);
    }
    revalidatePath(Routes.order(v.orderId));
    revalidatePath(Routes.order(result.exchangeOrderId));
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.Customers);
    return {
      ok: true,
      data: {
        returnId: result.returnId,
        returnCode: result.returnCode,
        exchangeOrderId: result.exchangeOrderId,
        exchangeOrderCode: result.exchangeOrderCode,
        difference: result.difference,
        direction: result.direction,
        ...(result.gatewayRefundId
          ? { gatewayRefundId: result.gatewayRefundId }
          : {}),
      },
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await exchangeResultForClientId(storeId, v.clientId);
      if (existing) return { ok: true, data: existing };
    }
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      ORDER_NOT_FOUND: "errors.invalidData",
      ORDER_CANCELLED: "returns.errors.orderCancelled",
      EXCHANGE_REQUIRES_PAID_ORDER: "returns.errors.exchangeRequiresPaidOrder",
      WAREHOUSE_REQUIRED: "returns.errors.warehouseRequired",
      ITEM_NOT_IN_ORDER: "errors.invalidData",
      QTY_EXCEEDS: "returns.errors.qtyExceeds",
      INSUFFICIENT_STOCK: "returns.errors.insufficientExchangeStock",
      INSUFFICIENT_BATCH_STOCK: "returns.errors.insufficientExchangeStock",
      DEBT_NEEDS_CUSTOMER: "returns.errors.debtNeedsCustomer",
      DEBT_TOO_SMALL: "returns.errors.debtTooSmall",
      REFUND_SOURCE_NOT_FOUND: "payments.errors.refundSourceNotFound",
      REFUND_PROVIDER_NOT_CONFIGURED: "payments.errors.providerNotConfigured",
    };
    if (known[message]) return { ok: false, error: known[message] };
    console.error("createExchange failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

/**
 * Trả hàng theo hóa đơn:
 * - SL trả ≤ SL mua − đã trả trước đó (check trong transaction)
 * - restock=true → cộng lại kho + movement 'return_in'
 * - refundMethod=debt_deduct → trừ công nợ khách; cash/CK chỉ ghi nhận chứng từ
 * - totalSpent của khách trừ theo giá trị trả
 */
export async function createReturn(
  input: CreateReturnOutput
): Promise<ActionResult<{ id: string; code: string; gatewayRefundId?: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  return createReturnForUser(gate.userId, input);
}

export async function createReturnForUser(
  userId: string,
  input: CreateReturnOutput,
): Promise<ActionResult<{ id: string; code: string; gatewayRefundId?: string }>> {

  const parsed = createReturnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const context = await resolveStoreContextForUser(userId);
  if (!context) return { ok: false, error: "errors.unauthorized" };
  const { storeId } = context;

  if (v.clientId) {
    const [existing] = await db.select({
      id: returns.id,
      code: returns.code,
      gatewayRefundId: paymentRefunds.id,
    }).from(returns)
      .leftJoin(paymentRefunds, eq(paymentRefunds.returnId, returns.id))
      .where(and(eq(returns.storeId, storeId), eq(returns.clientId, v.clientId))).limit(1);
    if (existing) return { ok: true, data: {
      id: existing.id,
      code: existing.code,
      ...(existing.gatewayRefundId ? { gatewayRefundId: existing.gatewayRefundId } : {}),
    } };
  }

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(storeId, profileId) : null;

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.storeId, storeId), eq(orders.id, v.orderId))).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      // chỉ trả hàng trên đơn bán thật (không quote/merged/cancelled/draft)
      if (order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_CANCELLED");

      const itemIds = v.items.map((i) => i.orderItemId);
      const sourceItems = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, storeId), inArray(orderItems.id, itemIds)));
      const sourceById = new Map(sourceItems.map((i) => [i.id, i]));

      // SL đã trả trước đó theo từng orderItem
      const prevReturned = await tx
        .select({
          orderItemId: returnItems.orderItemId,
          qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
        })
        .from(returnItems)
        .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
        .where(and(eq(returnItems.storeId, storeId), inArray(returnItems.orderItemId, itemIds)))
        .groupBy(returnItems.orderItemId);
      const prevByItem = new Map(prevReturned.map((r) => [r.orderItemId, Number(r.qty)]));

      let totalRefund = 0;
      const rows: (typeof returnItems.$inferInsert)[] = [];

      for (const i of v.items) {
        const src = sourceById.get(i.orderItemId);
        if (!src || src.orderId !== order.id) throw new Error("ITEM_NOT_IN_ORDER");
        const maxReturnable = Number(src.quantity) - (prevByItem.get(i.orderItemId) ?? 0);
        if (i.quantity > maxReturnable + 1e-9) throw new Error("QTY_EXCEEDS");

        const lineRefund = i.quantity * Number(src.unitPrice);
        totalRefund += lineRefund;
        rows.push({
          returnId: "", // gán sau khi có id
          orderItemId: src.id,
          productId: src.productId,
          productName: src.productName,
          unitName: src.unitName,
          unitMultiplier: src.unitMultiplier,
          quantity: toQty(i.quantity),
          unitPrice: src.unitPrice,
          total: toMoney(lineRefund),
          restock: i.restock,
        });
      }

      const gatewayPayment = isGatewayRefundMethod(v.refundMethod)
        ? await selectRefundableGatewayPayment(tx, storeId, order.id, v.refundMethod, totalRefund)
        : null;
      const gatewayReference = gatewayPayment && v.clientId
        ? gatewayRefundReference(v.refundMethod as GatewayProvider, v.clientId)
        : null;
      if (gatewayPayment && !gatewayReference) throw new Error("REFUND_PROVIDER_NOT_CONFIGURED");

      // Trừ nợ không vượt quá nợ hiện tại của khách
      let debtDelta = 0;
      if (v.refundMethod === "debt_deduct") {
        if (!order.customerId) throw new Error("DEBT_NEEDS_CUSTOMER");
        const [cust] = await tx
          .select({ debt: customers.currentDebt })
          .from(customers)
          .where(and(eq(customers.storeId, storeId), eq(customers.id, order.customerId)))
          .limit(1)
          .for("update");
        if (Number(cust.debt) < totalRefund - 1e-9) throw new Error("DEBT_TOO_SMALL");
        debtDelta = -Math.min(Number(cust.debt), totalRefund);
      }

      const [ret] = await tx.insert(returns).values({
        storeId,
        code: generateCode("TH"),
        clientId: v.clientId ?? null,
        orderId: order.id,
        customerId: order.customerId,
        warehouseId: order.warehouseId,
        reason: v.reason,
        refundMethod: v.refundMethod,
        totalRefund: toMoney(totalRefund),
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: returns.id, code: returns.code });

      await tx.insert(returnItems).values(rows.map((r) => ({ ...r, storeId, returnId: ret.id })));
      const [gatewayRefund] = gatewayPayment && gatewayReference && v.clientId
        ? await tx.insert(paymentRefunds).values({
            storeId,
            returnId: ret.id,
            paymentId: gatewayPayment.id,
            provider: gatewayPayment.provider!,
            reference: gatewayReference,
            clientRequestId: v.clientId,
            amount: toMoney(totalRefund),
            createdBy: profileId,
          }).returning({ id: paymentRefunds.id })
        : [];

      // Hoàn kho cho hàng restock
      if (order.warehouseId) {
        for (const r of rows.filter((x) => x.restock)) {
          const targets = await stockTargetsForReturnedItem(
            tx,
            storeId,
            r.productId,
            Number(r.quantity) * Number(r.unitMultiplier),
          );
          for (const target of targets) {
            await restoreOrReceiveTrackedStockLots(tx, {
              storeId,
              productId: target.productId,
              warehouseId: order.warehouseId,
              quantity: target.quantity,
              sourceRefType: "order",
              sourceRefId: order.id,
              refType: "return",
              refId: ret.id,
              fallbackBatchNumber: `RETURN-${ret.code}`,
              createdBy: profileId,
            });
            await tx
              .insert(stockLevels)
              .values({ storeId, productId: target.productId, warehouseId: order.warehouseId, quantity: toQty(target.quantity) })
              .onConflictDoUpdate({
                target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
                set: {
                  quantity: sql`${stockLevels.quantity} + ${toQty(target.quantity)}`,
                  updatedAt: sql`now()`,
                },
              });
            await tx.insert(stockMovements).values({
              storeId,
              productId: target.productId,
              warehouseId: order.warehouseId,
              type: "return_in",
              quantity: toQty(target.quantity),
              refType: "return",
              refId: ret.id,
              note: `${ret.code} ← ${order.code}`,
              createdBy: profileId,
            });
          }
        }
      }

      // Hoàn tiền mặt/CK → ghi phiếu chi
      if (v.refundMethod !== "debt_deduct" && !isGatewayRefundMethod(v.refundMethod)) {
        await recordCashTx(tx, {
          storeId,
          type: "out", fund: fundForMethod(v.refundMethod), amount: totalRefund,
          category: "refund", refType: "return", refId: ret.id,
          note: `Hoàn trả ${ret.code}`, createdBy: profileId, shiftId: currentShift?.id ?? null,
        });
      }

      // Điều chỉnh công nợ / tổng mua của khách
      if (order.customerId) {
        if (v.refundMethod === "debt_deduct") {
          await tx.update(customers).set({
            currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(totalRefund)}, 0)`,
            totalSpent: sql`greatest(${customers.totalSpent} - ${toMoney(totalRefund)}, 0)`,
          }).where(and(eq(customers.storeId, storeId), eq(customers.id, order.customerId)));
        } else {
          await tx.update(customers).set({
            totalSpent: sql`greatest(${customers.totalSpent} - ${toMoney(totalRefund)}, 0)`,
          }).where(and(eq(customers.storeId, storeId), eq(customers.id, order.customerId)));
        }
      }

      // Đánh dấu đơn nếu trả toàn bộ
      const allItems = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, order.id)));
      const allReturned = await tx
        .select({
          orderItemId: returnItems.orderItemId,
          qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
        })
        .from(returnItems)
        .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
        .innerJoin(orderItems, eq(returnItems.orderItemId, orderItems.id))
        .where(and(eq(returnItems.storeId, storeId), eq(orderItems.storeId, storeId), eq(orderItems.orderId, order.id)))
        .groupBy(returnItems.orderItemId);
      const returnedByItem = new Map(allReturned.map((r) => [r.orderItemId, Number(r.qty)]));
      const fullyReturned = allItems.every(
        (i) => (returnedByItem.get(i.id) ?? 0) >= Number(i.quantity) - 1e-9
      );
      if (fullyReturned) {
        await tx.update(orders).set({ status: "returned", updatedAt: sql`now()` }).where(and(eq(orders.storeId, storeId), eq(orders.id, order.id)));
      }

      const debtNotification = order.customerId && v.refundMethod === "debt_deduct"
        ? await createDebtChangedEventInTx(tx, {
            storeId,
            entityType: "customer",
            entityId: order.customerId,
            operationType: "sale_return",
            operationId: ret.id,
            delta: debtDelta,
            actorId: profileId,
          })
        : null;

      return {
        ...ret,
        ...(gatewayRefund ? { gatewayRefundId: gatewayRefund.id } : {}),
        debtNotification,
      };
    });

    if (result.debtNotification?.created) {
      await publishCommittedNotification(result.debtNotification.eventId);
    }
    revalidatePath(Routes.order(v.orderId));
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.Customers);
    return {
      ok: true,
      data: {
        id: result.id,
        code: result.code,
        ...(result.gatewayRefundId
          ? { gatewayRefundId: result.gatewayRefundId }
          : {}),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      ORDER_NOT_FOUND: "errors.invalidData",
      ORDER_CANCELLED: "returns.errors.orderCancelled",
      ITEM_NOT_IN_ORDER: "errors.invalidData",
      QTY_EXCEEDS: "returns.errors.qtyExceeds",
      DEBT_NEEDS_CUSTOMER: "returns.errors.debtNeedsCustomer",
      DEBT_TOO_SMALL: "returns.errors.debtTooSmall",
      REFUND_SOURCE_NOT_FOUND: "payments.errors.refundSourceNotFound",
      REFUND_PROVIDER_NOT_CONFIGURED: "payments.errors.providerNotConfigured",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createReturn failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateReturnMetadata(
  returnId: string,
  input: UpdateReturnMetadataInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = updateReturnMetadataSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  const [updated] = await db.update(returns).set({
    reason: parsed.data.reason,
    note: parsed.data.note?.trim() || null,
    updatedAt: sql`now()`,
  }).where(and(eq(returns.storeId, gate.storeId), eq(returns.id, returnId), eq(returns.status, "completed")))
    .returning({ id: returns.id });
  if (!updated) return { ok: false, error: "returns.errors.notEditable" };
  revalidatePath(Routes.Sales);
  revalidatePath(`/returns/${returnId}/print`);
  return { ok: true, data: undefined };
}

export async function cancelReturn(returnId: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;

  try {
    const profileId = await getProfileId(gate.userId);
    const currentShift = profileId ? await getCurrentShift(gate.storeId, profileId) : null;
    const result = await db.transaction(async (tx) => {
      const [ret] = await tx.select().from(returns)
        .where(and(eq(returns.storeId, gate.storeId), eq(returns.id, returnId))).limit(1).for("update");
      if (!ret) throw new Error("RETURN_NOT_FOUND");
      const [gatewayRefund] = await tx.select({ id: paymentRefunds.id })
        .from(paymentRefunds).where(and(eq(paymentRefunds.storeId, gate.storeId), eq(paymentRefunds.returnId, returnId))).limit(1);
      const blocked = returnCancellationBlockReason({
        status: ret.status,
        exchangeOrderId: ret.exchangeOrderId,
        hasGatewayRefund: Boolean(gatewayRefund),
      });
      if (blocked) throw new Error(blocked);

      const originalStockMovements = await tx.select({
        productId: stockMovements.productId,
        warehouseId: stockMovements.warehouseId,
        quantity: stockMovements.quantity,
      }).from(stockMovements).where(and(
        eq(stockMovements.storeId, gate.storeId),
        eq(stockMovements.refType, "return"),
        eq(stockMovements.refId, ret.id),
        eq(stockMovements.type, "return_in"),
      ));
      const stockTargets = returnCancellationStockTargets(originalStockMovements);

      for (const target of stockTargets) {
          const [level] = await tx.select({ quantity: stockLevels.quantity })
            .from(stockLevels)
            .where(and(eq(stockLevels.storeId, gate.storeId), eq(stockLevels.productId, target.productId), eq(stockLevels.warehouseId, target.warehouseId)))
            .limit(1)
            .for("update");
          if (!level || Number(level.quantity) < target.quantity - 1e-9) {
            throw new Error("INSUFFICIENT_STOCK_TO_CANCEL");
          }
          await consumeTrackedStockLots(tx, {
            storeId: gate.storeId,
            productId: target.productId,
            warehouseId: target.warehouseId,
            quantity: target.quantity,
            refType: "return_cancel",
            refId: ret.id,
            createdBy: profileId,
          });
          await tx.update(stockLevels).set({
            quantity: sql`${stockLevels.quantity} - ${toQty(target.quantity)}`,
            updatedAt: sql`now()`,
          }).where(and(eq(stockLevels.storeId, gate.storeId), eq(stockLevels.productId, target.productId), eq(stockLevels.warehouseId, target.warehouseId)));
          await tx.insert(stockMovements).values({
            storeId: gate.storeId,
            productId: target.productId,
            warehouseId: target.warehouseId,
            type: "return_out",
            quantity: toQty(-target.quantity),
            refType: "return_cancel",
            refId: ret.id,
            note: `Hủy phiếu trả ${ret.code}`,
            createdBy: profileId,
          });
      }

      const originalCashRows = await tx.select({
        fund: cashTransactions.fund,
        amount: cashTransactions.amount,
      }).from(cashTransactions).where(and(
        eq(cashTransactions.storeId, gate.storeId),
        eq(cashTransactions.refType, "return"),
        eq(cashTransactions.refId, ret.id),
        eq(cashTransactions.type, "out"),
      ));
      for (const row of originalCashRows) {
        await recordCashTx(tx, {
          storeId: gate.storeId,
          type: "in",
          fund: row.fund,
          amount: Number(row.amount),
          category: "refund",
          refType: "return_cancel",
          refId: ret.id,
          note: `Đảo hoàn trả ${ret.code}`,
          createdBy: profileId,
          shiftId: currentShift?.id ?? null,
        });
      }

      let debtNotification = null;
      if (ret.customerId) {
        const refund = Number(ret.totalRefund);
        const customerDeltas = returnCancellationCustomerDeltas({
          refundMethod: ret.refundMethod,
          totalRefund: refund,
        });
        await tx.update(customers).set({
          currentDebt: customerDeltas.currentDebt > 0
            ? sql`${customers.currentDebt} + ${toMoney(customerDeltas.currentDebt)}`
            : customers.currentDebt,
          totalSpent: sql`${customers.totalSpent} + ${toMoney(customerDeltas.totalSpent)}`,
        }).where(and(eq(customers.storeId, gate.storeId), eq(customers.id, ret.customerId)));
        if (ret.refundMethod === "debt_deduct") {
          debtNotification = await createDebtChangedEventInTx(tx, {
            storeId: gate.storeId,
            entityType: "customer",
            entityId: ret.customerId,
            operationType: "sale_return_cancel",
            operationId: ret.id,
            delta: refund,
            actorId: profileId,
          });
        }
      }

      await tx.update(returns).set({
        status: "cancelled",
        cancelledBy: profileId,
        cancelledAt: sql`now()`,
        updatedAt: sql`now()`,
      }).where(and(eq(returns.storeId, gate.storeId), eq(returns.id, ret.id)));

      if (ret.orderId) {
        const allItems = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, gate.storeId), eq(orderItems.orderId, ret.orderId)));
        const activeReturned = await tx.select({
          orderItemId: returnItems.orderItemId,
          qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
        }).from(returnItems)
          .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
          .innerJoin(orderItems, eq(returnItems.orderItemId, orderItems.id))
          .where(and(eq(returnItems.storeId, gate.storeId), eq(orderItems.storeId, gate.storeId), eq(orderItems.orderId, ret.orderId)))
          .groupBy(returnItems.orderItemId);
        const returnedByItem = new Map(activeReturned.map((row) => [row.orderItemId, Number(row.qty)]));
        const fullyReturned = allItems.length > 0 && allItems.every(
          (item) => (returnedByItem.get(item.id) ?? 0) >= Number(item.quantity) - 1e-9,
        );
        await tx.update(orders).set({
          status: fullyReturned ? "returned" : "completed",
          updatedAt: sql`now()`,
        }).where(and(eq(orders.storeId, gate.storeId), eq(orders.id, ret.orderId)));
      }
      return { debtNotification, orderId: ret.orderId };
    });

    if (result.debtNotification?.created) {
      await publishCommittedNotification(result.debtNotification.eventId);
    }
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Orders);
    if (result.orderId) revalidatePath(Routes.order(result.orderId));
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known: Record<string, string> = {
      RETURN_NOT_FOUND: "returns.errors.notFound",
      RETURN_ALREADY_CANCELLED: "returns.errors.alreadyCancelled",
      EXCHANGE_CANCEL_UNSUPPORTED: "returns.errors.exchangeCancelUnsupported",
      GATEWAY_CANCEL_UNSUPPORTED: "returns.errors.gatewayCancelUnsupported",
      WAREHOUSE_REQUIRED: "returns.errors.warehouseRequired",
      INSUFFICIENT_STOCK_TO_CANCEL: "returns.errors.insufficientStockToCancel",
      INSUFFICIENT_BATCH_STOCK: "returns.errors.insufficientStockToCancel",
    };
    if (known[message]) return { ok: false, error: known[message] };
    console.error("cancelReturn failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function createPosReturn(
  input: CreatePosReturnOutput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = createPosReturnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const profileId = await getProfileId(gate.userId);
    const currentShift = profileId ? await getCurrentShift(gate.storeId, profileId) : null;
    const trustedItems = await normalizeOrderItems(gate.storeId, v.items, v.priceBookId);

    const result = await db.transaction(async (tx) => {
      const [order] = v.orderId
        ? await tx.select().from(orders).where(and(eq(orders.storeId, gate.storeId), eq(orders.id, v.orderId))).limit(1)
        : [];
      if (v.orderId && !order) throw new Error("ORDER_NOT_FOUND");
      if (order && order.status !== "completed" && order.status !== "returned") throw new Error("ORDER_CANCELLED");

      const customerId = order?.customerId ?? v.customerId ?? null;
      const warehouseId = order?.warehouseId ?? v.warehouseId;
      const rows: (typeof returnItems.$inferInsert)[] = [];

      if (order) {
        const sourceItems = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, gate.storeId), eq(orderItems.orderId, order.id)));
        const sourceIds = sourceItems.map((item) => item.id);
        const prevReturned = sourceIds.length > 0
          ? await tx
              .select({
                orderItemId: returnItems.orderItemId,
                qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
              })
              .from(returnItems)
              .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
              .where(and(eq(returnItems.storeId, gate.storeId), inArray(returnItems.orderItemId, sourceIds)))
              .groupBy(returnItems.orderItemId)
          : [];
        const prevByItem = new Map(prevReturned.map((r) => [r.orderItemId, Number(r.qty)]));

        trustedItems.forEach((item, index) => {
          let remainingQty = item.quantity;
          const matches = sourceItems.filter((source) => source.productId === item.productId && source.unitName === item.unitName);
          for (const source of matches) {
            if (remainingQty <= 1e-9) break;
            const returnable = Number(source.quantity) - (prevByItem.get(source.id) ?? 0);
            if (returnable <= 1e-9) continue;
            const qty = Math.min(returnable, remainingQty);
            rows.push(returnItemRowFromTrusted({
              item: {
                ...item,
                quantity: qty,
                unitPrice: Number(source.unitPrice),
                total: qty * Number(source.unitPrice),
              },
              orderItemId: source.id,
              restock: v.items[index]?.restock ?? true,
            }));
            remainingQty -= qty;
          }
          if (remainingQty > 1e-9) throw new Error("QTY_EXCEEDS");
        });
      } else {
        trustedItems.forEach((item, index) => {
          rows.push(returnItemRowFromTrusted({
            item,
            orderItemId: null,
            restock: v.items[index]?.restock ?? true,
          }));
        });
      }

      const totalRefund = rows.reduce((sum, item) => sum + Number(item.total), 0);
      let debtDelta = 0;
      if (v.refundMethod === "debt_deduct") {
        if (!customerId) throw new Error("DEBT_NEEDS_CUSTOMER");
        const [cust] = await tx
          .select({ debt: customers.currentDebt })
          .from(customers)
          .where(and(eq(customers.storeId, gate.storeId), eq(customers.id, customerId)))
          .limit(1)
          .for("update");
        if (!cust || Number(cust.debt) < totalRefund - 1e-9) throw new Error("DEBT_TOO_SMALL");
        debtDelta = -Math.min(Number(cust.debt), totalRefund);
      }

      const [ret] = await tx.insert(returns).values({
        storeId: gate.storeId,
        code: generateCode("TH"),
        orderId: order?.id ?? null,
        customerId,
        warehouseId,
        reason: v.reason,
        refundMethod: v.refundMethod,
        totalRefund: toMoney(totalRefund),
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: returns.id, code: returns.code });

      await tx.insert(returnItems).values(rows.map((r) => ({ ...r, storeId: gate.storeId, returnId: ret.id })));

      for (const r of rows.filter((row) => row.restock)) {
        const targets = await stockTargetsForReturnedItem(
          tx,
          gate.storeId,
          r.productId,
          Number(r.quantity) * Number(r.unitMultiplier),
        );
        for (const target of targets) {
          if (order) {
            await restoreOrReceiveTrackedStockLots(tx, {
              storeId: gate.storeId,
              productId: target.productId,
              warehouseId,
              quantity: target.quantity,
              sourceRefType: "order",
              sourceRefId: order.id,
              refType: "return",
              refId: ret.id,
              fallbackBatchNumber: `RETURN-${ret.code}`,
              createdBy: profileId,
            });
          } else {
            await receiveUnspecifiedTrackedStockLot(tx, {
              storeId: gate.storeId,
              productId: target.productId,
              warehouseId,
              quantity: target.quantity,
              batchNumber: `RETURN-${ret.code}`,
              refType: "return",
              refId: ret.id,
              createdBy: profileId,
            });
          }
          await tx
            .insert(stockLevels)
            .values({ storeId: gate.storeId, productId: target.productId, warehouseId, quantity: toQty(target.quantity) })
            .onConflictDoUpdate({
              target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
              set: {
                quantity: sql`${stockLevels.quantity} + ${toQty(target.quantity)}`,
                updatedAt: sql`now()`,
              },
            });
          await tx.insert(stockMovements).values({
            storeId: gate.storeId,
            productId: target.productId,
            warehouseId,
            type: "return_in",
            quantity: toQty(target.quantity),
            refType: "return",
            refId: ret.id,
            note: order ? `${ret.code} ← ${order.code}` : ret.code,
            createdBy: profileId,
          });
        }
      }

      if (v.refundMethod !== "debt_deduct") {
        await recordCashTx(tx, {
          storeId: gate.storeId,
          type: "out",
          fund: fundForMethod(v.refundMethod),
          amount: totalRefund,
          category: "refund",
          refType: "return",
          refId: ret.id,
          note: `Hoàn trả ${ret.code}`,
          createdBy: profileId,
          shiftId: currentShift?.id ?? null,
        });
      }

      if (customerId) {
        await tx.update(customers).set({
          currentDebt: v.refundMethod === "debt_deduct"
            ? sql`greatest(${customers.currentDebt} - ${toMoney(totalRefund)}, 0)`
            : customers.currentDebt,
          totalSpent: sql`greatest(${customers.totalSpent} - ${toMoney(totalRefund)}, 0)`,
        }).where(and(eq(customers.storeId, gate.storeId), eq(customers.id, customerId)));
      }

      if (order) {
        const allItems = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, gate.storeId), eq(orderItems.orderId, order.id)));
        const allReturned = await tx
          .select({
            orderItemId: returnItems.orderItemId,
            qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
          })
          .from(returnItems)
          .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
          .innerJoin(orderItems, eq(returnItems.orderItemId, orderItems.id))
          .where(and(eq(returnItems.storeId, gate.storeId), eq(orderItems.storeId, gate.storeId), eq(orderItems.orderId, order.id)))
          .groupBy(returnItems.orderItemId);
        const returnedByItem = new Map(allReturned.map((r) => [r.orderItemId, Number(r.qty)]));
        const fullyReturned = allItems.every(
          (i) => (returnedByItem.get(i.id) ?? 0) >= Number(i.quantity) - 1e-9
        );
        if (fullyReturned) {
          await tx.update(orders).set({ status: "returned", updatedAt: sql`now()` }).where(and(eq(orders.storeId, gate.storeId), eq(orders.id, order.id)));
        }
      }

      const debtNotification = customerId && v.refundMethod === "debt_deduct"
        ? await createDebtChangedEventInTx(tx, {
            storeId: gate.storeId,
            entityType: "customer",
            entityId: customerId,
            operationType: "sale_return",
            operationId: ret.id,
            delta: debtDelta,
            actorId: profileId,
          })
        : null;
      return { ret, debtNotification };
    });

    if (result.debtNotification?.created) {
      await publishCommittedNotification(result.debtNotification.eventId);
    }
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Orders);
    if (v.orderId) revalidatePath(Routes.order(v.orderId));
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.Customers);
    return { ok: true, data: result.ret };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      ORDER_NOT_FOUND: "errors.invalidData",
      ORDER_CANCELLED: "returns.errors.orderCancelled",
      QTY_EXCEEDS: "returns.errors.qtyExceeds",
      DEBT_NEEDS_CUSTOMER: "returns.errors.debtNeedsCustomer",
      DEBT_TOO_SMALL: "returns.errors.debtTooSmall",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createPosReturn failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

function returnItemRowFromTrusted({
  item,
  orderItemId,
  restock,
}: {
  item: NormalizedOrderItem;
  orderItemId: string | null;
  restock: boolean;
}): typeof returnItems.$inferInsert {
  return {
    returnId: "",
    orderItemId,
    productId: item.productId,
    productName: item.productName,
    unitName: item.unitName,
    unitMultiplier: toQty(item.unitMultiplier),
    quantity: toQty(item.quantity),
    unitPrice: toMoney(item.unitPrice),
    total: toMoney(item.total),
    restock,
  };
}

import { and, count, desc, eq, exists, gte, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { customers, orders, profiles, returnItems, returns, warehouses } from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";

export type ReturnListRow = Awaited<ReturnType<typeof getReturns>>["rows"][number];

export async function getReturns({
  q,
  customerQuery,
  productQuery,
  orderQuery,
  reason,
  refundMethod,
  warehouseId,
  warehouseQuery,
  from,
  to,
  minTotal,
  maxTotal,
  includeCancelled = false,
  page = 1,
  pageSize = 20,
}: {
  q?: string;
  customerQuery?: string;
  productQuery?: string;
  orderQuery?: string;
  reason?: string;
  refundMethod?: string;
  warehouseId?: string;
  warehouseQuery?: string;
  from?: string;
  to?: string;
  minTotal?: number;
  maxTotal?: number;
  includeCancelled?: boolean;
  page?: number;
  pageSize?: number;
} = {}) {
  const query = q?.trim();
  const conditions: SQL[] = [];
  if (query) {
    const match = or(
        accentInsensitiveLike(returns.code, query),
        accentInsensitiveLike(orders.code, query),
        accentInsensitiveLike(customers.name, query),
        exists(
          db
            .select({ value: sql`1` })
            .from(returnItems)
            .where(
              and(
                eq(returnItems.returnId, returns.id),
                accentInsensitiveLike(returnItems.productName, query),
              ),
            ),
        ),
      );
    if (match) conditions.push(match);
  }
  if (customerQuery?.trim()) {
    const customerMatch = or(
      accentInsensitiveLike(customers.name, customerQuery.trim()),
      accentInsensitiveLike(customers.phone, customerQuery.trim()),
    );
    if (customerMatch) conditions.push(customerMatch);
  }
  if (productQuery?.trim()) {
    conditions.push(
      exists(
        db
          .select({ value: sql`1` })
          .from(returnItems)
          .where(
            and(
              eq(returnItems.returnId, returns.id),
              accentInsensitiveLike(returnItems.productName, productQuery.trim()),
            ),
          ),
      ),
    );
  }
  if (orderQuery?.trim()) {
    conditions.push(accentInsensitiveLike(orders.code, orderQuery.trim()));
  }
  if (reason?.trim() && reason !== "all") {
    conditions.push(accentInsensitiveLike(returns.reason, reason.trim()));
  }
  if (refundMethod?.trim() && refundMethod !== "all") {
    conditions.push(eq(returns.refundMethod, refundMethod as typeof returns.refundMethod.enumValues[number]));
  }
  if (warehouseId?.trim()) conditions.push(eq(returns.warehouseId, warehouseId.trim()));
  if (warehouseQuery?.trim()) {
    conditions.push(accentInsensitiveLike(warehouses.name, warehouseQuery.trim()));
  }
  if (!includeCancelled) conditions.push(ne(returns.status, "cancelled"));
  if (from) {
    const date = new Date(`${from}T00:00:00`);
    if (!Number.isNaN(date.getTime())) conditions.push(gte(returns.createdAt, date));
  }
  if (to) {
    const date = new Date(`${to}T23:59:59.999`);
    if (!Number.isNaN(date.getTime())) conditions.push(lte(returns.createdAt, date));
  }
  if (Number.isFinite(minTotal)) conditions.push(gte(returns.totalRefund, String(minTotal)));
  if (Number.isFinite(maxTotal)) conditions.push(lte(returns.totalRefund, String(maxTotal)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = Math.max(0, page - 1) * pageSize;

  const [rows, [{ total, totalRefund }]] = await Promise.all([
    db
      .select({
        id: returns.id,
        code: returns.code,
        reason: returns.reason,
        refundMethod: returns.refundMethod,
        totalRefund: returns.totalRefund,
        status: returns.status,
        note: returns.note,
        createdAt: returns.createdAt,
        orderId: returns.orderId,
        orderCode: orders.code,
        customerName: customers.name,
        customerPhone: customers.phone,
        warehouseName: warehouses.name,
        createdByName: profiles.fullName,
        itemCount: sql<number>`(
          select count(*)::int from ${returnItems}
          where ${returnItems.returnId} = ${returns.id}
        )`,
      })
      .from(returns)
      .leftJoin(orders, eq(returns.orderId, orders.id))
      .leftJoin(customers, eq(returns.customerId, customers.id))
      .leftJoin(warehouses, eq(returns.warehouseId, warehouses.id))
      .leftJoin(profiles, eq(returns.createdBy, profiles.id))
      .where(where)
      .orderBy(desc(returns.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({
        total: count(),
        totalRefund: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
      })
      .from(returns)
      .leftJoin(orders, eq(returns.orderId, orders.id))
      .leftJoin(customers, eq(returns.customerId, customers.id))
      .leftJoin(warehouses, eq(returns.warehouseId, warehouses.id))
      .where(where),
  ]);

  return {
    rows,
    total,
    totalRefund,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Chi tiết phiếu trả hàng (cho trang in). */
export async function getReturn(id: string) {
  const exchangeOrders = alias(orders, "exchange_orders");
  const [ret] = await db
    .select({
      id: returns.id,
      code: returns.code,
      reason: returns.reason,
      refundMethod: returns.refundMethod,
      totalRefund: returns.totalRefund,
      status: returns.status,
      note: returns.note,
      createdAt: returns.createdAt,
      orderId: returns.orderId,
      orderCode: orders.code,
      exchangeOrderId: returns.exchangeOrderId,
      exchangeOrderCode: exchangeOrders.code,
      exchangeDifference: returns.exchangeDifference,
      exchangeSettlementMethod: returns.exchangeSettlementMethod,
      customerName: customers.name,
      customerPhone: customers.phone,
      warehouseName: warehouses.name,
      createdByName: profiles.fullName,
      cancelledAt: returns.cancelledAt,
    })
    .from(returns)
    .leftJoin(orders, eq(returns.orderId, orders.id)) // orderId nullable (trả nhanh)
    .leftJoin(exchangeOrders, eq(returns.exchangeOrderId, exchangeOrders.id))
    .leftJoin(customers, eq(returns.customerId, customers.id))
    .leftJoin(warehouses, eq(returns.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(returns.createdBy, profiles.id))
    .where(eq(returns.id, id))
    .limit(1);
  if (!ret) return null;

  const items = await db.select().from(returnItems).where(eq(returnItems.returnId, id));
  return { ...ret, items };
}

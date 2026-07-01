import { count, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders, profiles, returnItems, returns, warehouses } from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";

export type ReturnListRow = Awaited<ReturnType<typeof getReturns>>["rows"][number];

export async function getReturns({
  q,
  page = 1,
  pageSize = 20,
}: {
  q?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const query = q?.trim();
  const where = query
    ? or(
        accentInsensitiveLike(returns.code, query),
        accentInsensitiveLike(orders.code, query),
        accentInsensitiveLike(customers.name, query),
      )
    : undefined;
  const offset = Math.max(0, page - 1) * pageSize;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: returns.id,
        code: returns.code,
        reason: returns.reason,
        refundMethod: returns.refundMethod,
        totalRefund: returns.totalRefund,
        note: returns.note,
        createdAt: returns.createdAt,
        orderId: returns.orderId,
        orderCode: orders.code,
        customerName: customers.name,
        warehouseName: warehouses.name,
        createdByName: profiles.fullName,
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
      .select({ total: count() })
      .from(returns)
      .leftJoin(orders, eq(returns.orderId, orders.id))
      .leftJoin(customers, eq(returns.customerId, customers.id))
      .where(where),
  ]);

  return { rows, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Chi tiết phiếu trả hàng (cho trang in). */
export async function getReturn(id: string) {
  const [ret] = await db
    .select({
      id: returns.id,
      code: returns.code,
      reason: returns.reason,
      refundMethod: returns.refundMethod,
      totalRefund: returns.totalRefund,
      note: returns.note,
      createdAt: returns.createdAt,
      orderId: returns.orderId,
      orderCode: orders.code,
      customerName: customers.name,
      customerPhone: customers.phone,
      warehouseName: warehouses.name,
      createdByName: profiles.fullName,
    })
    .from(returns)
    .leftJoin(orders, eq(returns.orderId, orders.id)) // orderId nullable (trả nhanh)
    .leftJoin(customers, eq(returns.customerId, customers.id))
    .leftJoin(warehouses, eq(returns.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(returns.createdBy, profiles.id))
    .where(eq(returns.id, id))
    .limit(1);
  if (!ret) return null;

  const items = await db.select().from(returnItems).where(eq(returnItems.returnId, id));
  return { ...ret, items };
}

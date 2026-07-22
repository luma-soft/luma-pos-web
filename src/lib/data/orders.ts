import { and, count, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  customers, einvoices, orderItems, orders, payments, profiles, returnItems, returns, warehouses,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";

export const ORDERS_PAGE_SIZE = 20;

export type OrderStatusFilter = "all" | "completed" | "cancelled" | "owing" | "returned";
export type OrderPaymentFilter = "all" | "paid" | "unpaid" | "partial";
export type OrderSourceFilter = "all" | "pos" | "shopee" | "tiktok_shop" | "lazada" | "tiki";

export interface OrderListFilters {
  orderId?: string;
  q?: string;
  status?: OrderStatusFilter;
  payment?: OrderPaymentFilter;
  source?: OrderSourceFilter;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  page?: number;
  pageSize?: number;
}

export async function getOrders(filters: OrderListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions: SQL[] = [ne(orders.status, "quote"), ne(orders.status, "confirmed")]; // báo giá / đặt hàng có trang riêng
  if (filters.orderId) conditions.push(eq(orders.id, filters.orderId));

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(
      accentInsensitiveLike(orders.code, q),
      accentInsensitiveLike(customers.name, q),
      accentInsensitiveLike(orders.projectName, q),
    );
    if (c) conditions.push(c);
  }
  if (filters.status === "completed") conditions.push(eq(orders.status, "completed"));
  if (filters.status === "cancelled") conditions.push(eq(orders.status, "cancelled"));
  if (filters.status === "returned") conditions.push(eq(orders.status, "returned"));
  if (filters.status === "owing") {
    const c = and(
      or(eq(orders.paymentStatus, "unpaid"), eq(orders.paymentStatus, "deposit"), eq(orders.paymentStatus, "partial")),
      eq(orders.status, "completed"),
    );
    if (c) conditions.push(c);
  }
  // lọc theo trạng thái thanh toán (độc lập với tab trạng thái đơn)
  if (filters.payment === "paid") conditions.push(eq(orders.paymentStatus, "paid"));
  else if (filters.payment === "unpaid") conditions.push(eq(orders.paymentStatus, "unpaid"));
  else if (filters.payment === "partial") {
    const c = or(eq(orders.paymentStatus, "deposit"), eq(orders.paymentStatus, "partial"));
    if (c) conditions.push(c);
  }
  if (filters.source && !["all", "pos"].includes(filters.source)) conditions.push(eq(orders.sourceMode, filters.source));
  else if (filters.source === "pos") conditions.push(sql`coalesce(${orders.sourceMode}, '') <> 'shopee'`);
  // khoảng ngày
  if (filters.from) {
    const d = new Date(`${filters.from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(orders.createdAt, d));
  }
  if (filters.to) {
    const d = new Date(`${filters.to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(orders.createdAt, d));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      projectName: orders.projectName,
      total: orders.total,
      amountPaid: orders.amountPaid,
      sourceMode: orders.sourceMode,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerType: customers.type,
      eInvoice: {
        id: einvoices.id,
        status: einvoices.status,
        number: einvoices.number,
        provider: einvoices.provider,
        attemptCount: einvoices.attemptCount,
        nextAttemptAt: einvoices.nextAttemptAt,
        lastError: einvoices.lastError,
        issuedAt: einvoices.issuedAt,
      },
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(einvoices, eq(orders.id, einvoices.orderId));

  const countQ = db
    .select({ total: count() })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id));

  const [rows, [{ total }]] = await Promise.all([
    base.where(where).orderBy(desc(orders.createdAt)).limit(size).offset((page - 1) * size),
    countQ.where(where),
  ]);

  return { rows, total, page, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)) };
}

export async function getOrder(id: string) {
  const [order] = await db
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      projectName: orders.projectName,
      deliveryAddress: orders.deliveryAddress,
      deliveryDate: orders.deliveryDate,
      subtotal: orders.subtotal,
      discount: orders.discount,
      tax: orders.tax,
      shippingFee: orders.shippingFee,
      total: orders.total,
      amountPaid: orders.amountPaid,
      sourceOrderId: orders.sourceOrderId,
      sourceMode: orders.sourceMode,
      sourceSaleTime: orders.sourceSaleTime,
      hasCreatedOrder: sql<boolean>`exists (
        select 1 from orders converted
        where converted.source_order_id = ${orders.id}
          and converted.source_mode = 'copy'
          and converted.status not in ('quote', 'confirmed', 'cancelled')
      )`,
      replacedByOrderId: orders.replacedByOrderId,
      note: orders.note,
      createdAt: orders.createdAt,
      customerId: orders.customerId,
      projectId: orders.projectId,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerZaloUserId: customers.zaloUserId,
      customerType: customers.type,
      customerDebt: customers.currentDebt,
      warehouseName: warehouses.name,
      sellerName: profiles.fullName,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(warehouses, eq(orders.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(orders.createdBy, profiles.id))
    .where(eq(orders.id, id))
    .limit(1);

  if (!order) return null;

  const [items, paymentRows, returnRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)),
    db.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.createdAt)),
    db.select().from(returns).where(eq(returns.orderId, id)).orderBy(desc(returns.createdAt)),
  ]);

  // SL đã trả theo từng dòng hàng
  const itemIds = items.map((i) => i.id);
  const returnedAgg = itemIds.length
    ? await db
        .select({
          orderItemId: returnItems.orderItemId,
          qty: sql<string>`coalesce(sum(${returnItems.quantity}), 0)`,
        })
        .from(returnItems)
        .where(inArray(returnItems.orderItemId, itemIds))
        .groupBy(returnItems.orderItemId)
    : [];
  const returnedByItem = Object.fromEntries(returnedAgg.map((r) => [r.orderItemId, Number(r.qty)]));

  return { ...order, items, payments: paymentRows, returns: returnRows, returnedByItem };
}

export type OrderListResult = Awaited<ReturnType<typeof getOrders>>;
export type OrderListRow = OrderListResult["rows"][number];
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

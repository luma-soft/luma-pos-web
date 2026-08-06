import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  einvoices,
  orderItems,
  orders,
  payments,
  priceBooks,
  products,
  profiles,
  returnItems,
  returns,
  warehouses,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";

export const ORDERS_PAGE_SIZE = 20;

export type OrderStatusFilter =
  | "all"
  | "completed"
  | "cancelled"
  | "owing"
  | "returned"
  | "draft"
  | "quote"
  | "confirmed"
  | "delivering";
export type OrderPaymentFilter = "all" | "paid" | "unpaid" | "partial";
export type OrderPaymentMethodFilter =
  "all" | "cash" | "bank_transfer" | "card";
export type OrderSourceFilter =
  "all" | "pos" | "shopee" | "tiktok_shop" | "lazada" | "tiki";

export interface OrderListFilters {
  orderId?: string;
  q?: string;
  customerId?: string;
  productId?: string;
  customerQuery?: string;
  productQuery?: string;
  status?: OrderStatusFilter;
  payment?: OrderPaymentFilter;
  paymentMethod?: OrderPaymentMethodFilter;
  source?: OrderSourceFilter;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  minTotal?: number;
  maxTotal?: number;
  includeCancelled?: boolean;
  page?: number;
  pageSize?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value?: string): value is string {
  return Boolean(value && UUID_RE.test(value));
}

export async function getOrders(filters: OrderListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions: SQL[] = [];
  if (filters.status === "quote") conditions.push(eq(orders.status, "quote"));
  else if (filters.status === "confirmed")
    conditions.push(eq(orders.status, "confirmed"));
  else {
    // Báo giá / đặt hàng chỉ xuất hiện khi mobile yêu cầu đúng tab.
    conditions.push(ne(orders.status, "quote"), ne(orders.status, "confirmed"));
  }
  if (filters.orderId) conditions.push(eq(orders.id, filters.orderId));

  if (filters.status !== "cancelled" && !filters.includeCancelled) {
    conditions.push(ne(orders.status, "cancelled"));
  }

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(
      accentInsensitiveLike(orders.code, q),
      accentInsensitiveLike(customers.name, q),
      accentInsensitiveLike(orders.projectName, q),
    );
    if (c) conditions.push(c);
  }
  if (isUuid(filters.customerId)) {
    conditions.push(eq(orders.customerId, filters.customerId));
  }
  if (isUuid(filters.productId)) {
    conditions.push(
      exists(
        db
          .select({ value: sql`1` })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.orderId, orders.id),
              eq(orderItems.productId, filters.productId),
            ),
          ),
      ),
    );
  }
  if (filters.customerQuery?.trim()) {
    const customerQuery = filters.customerQuery.trim();
    const customerMatch = or(
      accentInsensitiveLike(customers.name, customerQuery),
      accentInsensitiveLike(customers.phone, customerQuery),
    );
    if (customerMatch) conditions.push(customerMatch);
  }
  if (filters.productQuery?.trim()) {
    const productQuery = filters.productQuery.trim();
    const productMatch = or(
      accentInsensitiveLike(orderItems.productName, productQuery),
      accentInsensitiveLike(products.name, productQuery),
      accentInsensitiveLike(products.sku, productQuery),
      accentInsensitiveLike(products.barcode, productQuery),
    );
    if (productMatch) {
      conditions.push(
        exists(
          db
            .select({ value: sql`1` })
            .from(orderItems)
            .leftJoin(products, eq(orderItems.productId, products.id))
            .where(and(eq(orderItems.orderId, orders.id), productMatch)),
        ),
      );
    }
  }
  if (filters.status === "completed")
    conditions.push(eq(orders.status, "completed"));
  if (filters.status === "cancelled")
    conditions.push(eq(orders.status, "cancelled"));
  if (filters.status === "returned")
    conditions.push(eq(orders.status, "returned"));
  if (filters.status === "draft") conditions.push(eq(orders.status, "draft"));
  if (filters.status === "delivering")
    conditions.push(eq(orders.status, "delivering"));
  if (filters.status === "owing") {
    const c = and(
      or(
        eq(orders.paymentStatus, "unpaid"),
        eq(orders.paymentStatus, "deposit"),
        eq(orders.paymentStatus, "partial"),
      ),
      eq(orders.status, "completed"),
    );
    if (c) conditions.push(c);
  }
  // lọc theo trạng thái thanh toán (độc lập với tab trạng thái đơn)
  if (filters.payment === "paid")
    conditions.push(eq(orders.paymentStatus, "paid"));
  else if (filters.payment === "unpaid")
    conditions.push(eq(orders.paymentStatus, "unpaid"));
  else if (filters.payment === "partial") {
    const c = or(
      eq(orders.paymentStatus, "deposit"),
      eq(orders.paymentStatus, "partial"),
    );
    if (c) conditions.push(c);
  }
  if (filters.paymentMethod && filters.paymentMethod !== "all") {
    conditions.push(
      exists(
        db
          .select({ value: sql`1` })
          .from(payments)
          .where(
            and(
              eq(payments.orderId, orders.id),
              eq(payments.method, filters.paymentMethod),
            ),
          ),
      ),
    );
  }
  if (filters.source && !["all", "pos"].includes(filters.source))
    conditions.push(eq(orders.sourceMode, filters.source));
  else if (filters.source === "pos")
    conditions.push(sql`coalesce(${orders.sourceMode}, '') <> 'shopee'`);
  // khoảng ngày
  if (filters.from) {
    const d = new Date(`${filters.from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) conditions.push(gte(orders.createdAt, d));
  }
  if (filters.to) {
    const d = new Date(`${filters.to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) conditions.push(lte(orders.createdAt, d));
  }
  if (Number.isFinite(filters.minTotal)) {
    conditions.push(gte(orders.total, String(filters.minTotal)));
  }
  if (Number.isFinite(filters.maxTotal)) {
    conditions.push(lte(orders.total, String(filters.maxTotal)));
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
      itemCount: sql<number>`(
        select count(*)::int from ${orderItems}
        where ${orderItems.orderId} = ${orders.id}
      )`,
      paymentMethod: sql<string | null>`(
        select ${payments.method} from ${payments}
        where ${payments.orderId} = ${orders.id}
        order by ${payments.createdAt} desc
        limit 1
      )`,
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
    base
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    countQ.where(where),
  ]);

  return {
    rows,
    total,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
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
      priceBookName: sql<string | null>`(
        select ${priceBooks.name} from ${orderItems}
        left join ${priceBooks} on ${orderItems.priceBookId} = ${priceBooks.id}
        where ${orderItems.orderId} = ${orders.id}
          and ${orderItems.priceBookId} is not null
        limit 1
      )`,
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
    db
      .select()
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(desc(payments.createdAt)),
    db
      .select()
      .from(returns)
      .where(eq(returns.orderId, id))
      .orderBy(desc(returns.createdAt)),
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
        .innerJoin(returns, and(eq(returnItems.returnId, returns.id), eq(returns.status, "completed")))
        .where(inArray(returnItems.orderItemId, itemIds))
        .groupBy(returnItems.orderItemId)
    : [];
  const returnedByItem = Object.fromEntries(
    returnedAgg.map((r) => [r.orderItemId, Number(r.qty)]),
  );

  return {
    ...order,
    items,
    payments: paymentRows,
    returns: returnRows,
    returnedByItem,
  };
}

export type OrderListResult = Awaited<ReturnType<typeof getOrders>>;
export type OrderListRow = OrderListResult["rows"][number];
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

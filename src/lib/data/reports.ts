import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  categories,
  customers,
  orderItems,
  orders,
  products,
  returnItems,
  returns,
} from "@/db/schema";
import { calculateDashboardFinancials } from "@/lib/dashboard/financials";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";

export type ReportFilters = {
  customerId?: string;
  customer?: string;
  q?: string;
  from?: Date;
  to?: Date;
};

type ReportDatabase = typeof db;

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function daysAgo(amount: number) {
  return addDays(startOfDay(new Date()), -amount);
}

function reportBounds(rangeDays: number, filters: ReportFilters) {
  return {
    from: filters.from ?? daysAgo(rangeDays - 1),
    to: filters.to ?? addDays(startOfDay(new Date()), 1),
  };
}

function customerSearchCondition(filters: ReportFilters, customerColumn: AnyPgColumn) {
  const term = filters.customer?.trim() || filters.q?.trim() || "";
  if (filters.customerId) return eq(customerColumn, filters.customerId);
  if (!term) return undefined;
  return or(
    ilike(customers.name, `%${term}%`),
    ilike(customers.phone, `%${term}%`),
    ilike(customers.code, `%${term}%`),
  );
}

function reportConditions(storeId: string, rangeDays: number, filters: ReportFilters) {
  const { from, to } = reportBounds(rangeDays, filters);
  const orderCustomer = customerSearchCondition(filters, orders.customerId);
  const returnCustomer = customerSearchCondition(filters, returns.customerId);
  return {
    from,
    to,
    where: and(
      eq(orders.storeId, storeId),
      eq(orders.documentType, "sale"),
      inArray(orders.status, ["completed", "returned"]),
      gte(orders.createdAt, from),
      lt(orders.createdAt, to),
      orderCustomer,
    ),
    operationalWhere: and(
      eq(orders.storeId, storeId),
      eq(orders.documentType, "sale"),
      inArray(orders.status, ["confirmed", "delivering", "completed", "cancelled", "returned"]),
      gte(orders.createdAt, from),
      lt(orders.createdAt, to),
      orderCustomer,
    ),
    returnWhere: and(
      eq(returns.storeId, storeId),
      eq(returns.status, "completed"),
      gte(returns.createdAt, from),
      lt(returns.createdAt, to),
      returnCustomer,
    ),
  };
}

function paginated<T>(rows: T[], total: number, page: number, pageSize: number) {
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getReports(storeId: string, rangeDays = 30, filters: ReportFilters = {}) {
  return getReportsForDatabase(db, storeId, rangeDays, filters);
}

export async function getReportInvoices(
  storeId: string,
  rangeDays = 30,
  filters: ReportFilters = {},
  page = 1,
  pageSize = 15,
) {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const { operationalWhere, returnWhere } = reportConditions(storeId, rangeDays, filters);
  const [saleRows, [countRow]] = await Promise.all([
    db.select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      createdAt: orders.createdAt,
      customerName: sql<string>`coalesce(${customers.name}, 'Khách lẻ')`,
      total: orders.total,
      amountPaid: orders.amountPaid,
      cost: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}), 0)`,
      profit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(operationalWhere)
      .groupBy(orders.id, customers.name)
      .orderBy(desc(orders.createdAt))
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize),
    db.select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(operationalWhere),
  ]);
  const orderIds = saleRows.map((row) => row.id);
  const returnedRows = orderIds.length === 0 ? [] : await db.select({
    orderId: returns.orderId,
    refund: sql<string>`coalesce(sum(${returnItems.total}), 0)`,
    returnedCost: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice}), 0)`,
    returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
  })
    .from(returnItems)
    .innerJoin(returns, eq(returnItems.returnId, returns.id))
    .innerJoin(products, eq(returnItems.productId, products.id))
    .leftJoin(customers, eq(returns.customerId, customers.id))
    .where(and(returnWhere, inArray(returns.orderId, orderIds)))
    .groupBy(returns.orderId);
  const returnedByOrder = new Map(returnedRows.map((row) => [row.orderId, row]));
  const rows = saleRows.map((row) => {
    const returned = returnedByOrder.get(row.id);
    const refund = Number(returned?.refund ?? 0);
    const netRevenue = Number(row.total) - refund;
    const cost = Number(row.cost) - Number(returned?.returnedCost ?? 0);
    const profit = Number(row.profit) - Number(returned?.returnedProfit ?? 0);
    return {
      ...row,
      total: netRevenue,
      cost,
      profit,
      refund,
      margin: netRevenue === 0 ? 0 : (profit / netRevenue) * 100,
    };
  });
  return paginated(rows, countRow?.total ?? 0, safePage, safePageSize);
}

export type ReportInvoiceRow = Awaited<ReturnType<typeof getReportInvoices>>["rows"][number];

type ProductSaleRow = {
  productId: string;
  productName: string;
  qtySold: string;
  baseUnit: string;
  imageUrls: string[] | null;
  revenue: string;
  cost: string;
  profit: string;
};

type ProductReturnRow = {
  productId: string;
  qtyReturned: string;
  refund: string;
  returnedCost: string;
  returnedProfit: string;
  returnCount: number;
};

function mergeProductRow(row: ProductSaleRow, returned?: ProductReturnRow) {
  const revenue = Number(row.revenue) - Number(returned?.refund ?? 0);
  const cost = Number(row.cost) - Number(returned?.returnedCost ?? 0);
  const profit = Number(row.profit) - Number(returned?.returnedProfit ?? 0);
  return {
    productId: row.productId,
    productName: row.productName,
    qtySold: Number(row.qtySold),
    qtyReturned: Number(returned?.qtyReturned ?? 0),
    baseUnit: row.baseUnit,
    imageUrls: row.imageUrls ?? [],
    revenue,
    cost,
    profit,
    margin: revenue === 0 ? 0 : (profit / revenue) * 100,
    returnCount: returned?.returnCount ?? 0,
  };
}

export async function getReportProducts(
  storeId: string,
  rangeDays = 30,
  filters: ReportFilters = {},
  page = 1,
  pageSize = 15,
) {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const { where, returnWhere } = reportConditions(storeId, rangeDays, filters);
  const [saleRows, [countRow]] = await Promise.all([
    db.select({
      productId: orderItems.productId,
      productName: sql<string>`max(${orderItems.productName})`,
      qtySold: sql<string>`sum(${orderItems.quantity} * ${orderItems.unitMultiplier})`,
      baseUnit: sql<string>`max(${products.baseUnit})`,
      imageUrls: productCompatibilityImageUrls(storeId),
      revenue: sql<string>`sum(${orderItems.total})`,
      cost: sql<string>`sum(${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})`,
      profit: sql<string>`sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}))`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(orderItems.productId, products.id, products.imageUrls)
      .orderBy(desc(sql`sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}))`))
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize),
    db.select({ total: sql<number>`count(distinct ${orderItems.productId})::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where),
  ]);
  const productIds = saleRows.map((row) => row.productId);
  const returnedRows = productIds.length === 0 ? [] : await db.select({
    productId: returnItems.productId,
    qtyReturned: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier}), 0)`,
    refund: sql<string>`coalesce(sum(${returnItems.total}), 0)`,
    returnedCost: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice}), 0)`,
    returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
    returnCount: sql<number>`count(distinct ${returns.id})::int`,
  })
    .from(returnItems)
    .innerJoin(returns, eq(returnItems.returnId, returns.id))
    .innerJoin(products, eq(returnItems.productId, products.id))
    .leftJoin(customers, eq(returns.customerId, customers.id))
    .where(and(returnWhere, inArray(returnItems.productId, productIds)))
    .groupBy(returnItems.productId);
  const returnedByProduct = new Map(returnedRows.map((row) => [row.productId, row]));
  const merged = saleRows.map((row) => mergeProductRow(row, returnedByProduct.get(row.productId)));
  const totalRevenue = merged.reduce((sum, row) => sum + row.revenue, 0);
  const rows = merged.map((row) => ({
    ...row,
    contribution: totalRevenue === 0 ? 0 : (row.revenue / totalRevenue) * 100,
  }));
  return paginated(rows, countRow?.total ?? 0, safePage, safePageSize);
}

export async function getReportCustomers(
  storeId: string,
  rangeDays = 30,
  filters: ReportFilters = {},
  page = 1,
  pageSize = 15,
) {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const { from, to, where, returnWhere } = reportConditions(storeId, rangeDays, filters);
  const [saleRows, [countRow]] = await Promise.all([
    db.select({
      customerId: orders.customerId,
      customerName: sql<string>`coalesce(max(${customers.name}), 'Khách lẻ')`,
      customerType: sql<string | null>`max(${customers.type})`,
      customerCreatedAt: sql<Date | null>`max(${customers.createdAt})`,
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<string>`sum(${orders.total})`,
      remaining: sql<string>`sum(${orders.total} - ${orders.amountPaid})`,
      lastPurchaseAt: sql<Date>`max(${orders.createdAt})`,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(orders.customerId)
      .orderBy(desc(sql`sum(${orders.total})`))
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize),
    db.select({ total: sql<number>`count(distinct coalesce(${orders.customerId}::text, '__walkin__'))::int` })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where),
  ]);
  const customerIds = saleRows.map((row) => row.customerId).filter((value): value is string => Boolean(value));
  const customerSubset = customerIds.length ? inArray(orders.customerId, customerIds) : undefined;
  const returnSubset = customerIds.length ? inArray(returns.customerId, customerIds) : undefined;
  const [profitRows, refundRows, returnedProfitRows] = await Promise.all([
    db.select({
      customerId: orders.customerId,
      profit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id)).where(and(where, customerSubset)).groupBy(orders.customerId),
    db.select({ customerId: returns.customerId, refund: sql<string>`coalesce(sum(${returns.totalRefund}), 0)` })
      .from(returns).leftJoin(customers, eq(returns.customerId, customers.id)).where(and(returnWhere, returnSubset)).groupBy(returns.customerId),
    db.select({
      customerId: returns.customerId,
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(returnItems).innerJoin(returns, eq(returnItems.returnId, returns.id)).innerJoin(products, eq(returnItems.productId, products.id))
      .leftJoin(customers, eq(returns.customerId, customers.id)).where(and(returnWhere, returnSubset)).groupBy(returns.customerId),
  ]);
  const profitMap = new Map(profitRows.map((row) => [row.customerId, Number(row.profit)]));
  const refundMap = new Map(refundRows.map((row) => [row.customerId, Number(row.refund)]));
  const returnedProfitMap = new Map(returnedProfitRows.map((row) => [row.customerId, Number(row.returnedProfit)]));
  const rows = saleRows.map((row) => {
    const revenue = Number(row.revenue) - (refundMap.get(row.customerId) ?? 0);
    const profit = (profitMap.get(row.customerId) ?? 0) - (returnedProfitMap.get(row.customerId) ?? 0);
    const createdAt = row.customerCreatedAt ? new Date(row.customerCreatedAt) : null;
    return {
      ...row,
      revenue,
      profit,
      margin: revenue === 0 ? 0 : (profit / revenue) * 100,
      averageOrder: row.orderCount === 0 ? 0 : revenue / row.orderCount,
      segment: createdAt && createdAt >= from && createdAt < to ? "new" as const : "returning" as const,
    };
  });
  return paginated(rows, countRow?.total ?? 0, safePage, safePageSize);
}

export type ReportProductRow = Awaited<ReturnType<typeof getReportProducts>>["rows"][number];
export type ReportCustomerRow = Awaited<ReturnType<typeof getReportCustomers>>["rows"][number];

async function getCoreReportsForDatabase(
  database: ReportDatabase,
  storeId: string,
  rangeDays: number,
  filters: ReportFilters,
) {
  const { from, to, where, operationalWhere, returnWhere } = reportConditions(storeId, rangeDays, filters);
  const [
    summaryRows, profitRows, refundRows, returnedProfitRows,
    grossByDay, profitByDay, refundsByDay, returnedProfitByDay,
    productSaleRows, productReturnRows,
    customerSaleRows, customerProfitRows, customerRefundRows, customerReturnedProfitRows,
    byCategory, statusRows,
  ] = await Promise.all([
    database.select({
      grossRevenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      collected: sql<string>`coalesce(sum(${orders.amountPaid}), 0)`,
      orderCount: sql<number>`count(*)::int`,
      customerCount: sql<number>`count(distinct ${orders.customerId})::int`,
    }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where),
    database.select({
      grossProfit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
      costOfGoods: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}), 0)`,
      quantitySold: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitMultiplier}), 0)`,
      productCount: sql<number>`count(distinct ${orderItems.productId})::int`,
    }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id)).where(where),
    database.select({
      refundTotal: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
      returnCount: sql<number>`count(*)::int`,
    }).from(returns).leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere),
    database.select({
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
      returnedCost: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice}), 0)`,
      returnedQuantity: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier}), 0)`,
    }).from(returnItems).innerJoin(returns, eq(returnItems.returnId, returns.id)).innerJoin(products, eq(returnItems.productId, products.id))
      .leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere),
    database.select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      orderCount: sql<number>`count(*)::int`,
    }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where)
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`),
    database.select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      profit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
      cost: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}), 0)`,
    }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id)).where(where)
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`),
    database.select({
      day: sql<string>`to_char(${returns.createdAt}, 'YYYY-MM-DD')`,
      refund: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
      returnCount: sql<number>`count(*)::int`,
    }).from(returns).leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere)
      .groupBy(sql`to_char(${returns.createdAt}, 'YYYY-MM-DD')`),
    database.select({
      day: sql<string>`to_char(${returns.createdAt}, 'YYYY-MM-DD')`,
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
      returnedCost: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice}), 0)`,
    }).from(returnItems).innerJoin(returns, eq(returnItems.returnId, returns.id)).innerJoin(products, eq(returnItems.productId, products.id))
      .leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere)
      .groupBy(sql`to_char(${returns.createdAt}, 'YYYY-MM-DD')`),
    database.select({
      productId: orderItems.productId,
      productName: sql<string>`max(${orderItems.productName})`,
      qtySold: sql<string>`sum(${orderItems.quantity} * ${orderItems.unitMultiplier})`,
      baseUnit: sql<string>`max(${products.baseUnit})`,
      imageUrls: productCompatibilityImageUrls(storeId),
      revenue: sql<string>`sum(${orderItems.total})`,
      cost: sql<string>`sum(${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})`,
      profit: sql<string>`sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}))`,
    }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id)).where(where).groupBy(orderItems.productId, products.id, products.imageUrls),
    database.select({
      productId: returnItems.productId,
      qtyReturned: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier}), 0)`,
      refund: sql<string>`coalesce(sum(${returnItems.total}), 0)`,
      returnedCost: sql<string>`coalesce(sum(${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice}), 0)`,
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
      returnCount: sql<number>`count(distinct ${returns.id})::int`,
    }).from(returnItems).innerJoin(returns, eq(returnItems.returnId, returns.id)).innerJoin(products, eq(returnItems.productId, products.id))
      .leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere).groupBy(returnItems.productId),
    database.select({
      customerId: orders.customerId,
      customerName: sql<string>`coalesce(max(${customers.name}), 'Khách lẻ')`,
      customerType: sql<string | null>`max(${customers.type})`,
      customerCreatedAt: sql<Date | null>`max(${customers.createdAt})`,
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<string>`sum(${orders.total})`,
      remaining: sql<string>`sum(${orders.total} - ${orders.amountPaid})`,
      lastPurchaseAt: sql<Date>`max(${orders.createdAt})`,
    }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where).groupBy(orders.customerId),
    database.select({
      customerId: orders.customerId,
      profit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id)).where(where).groupBy(orders.customerId),
    database.select({ customerId: returns.customerId, refund: sql<string>`coalesce(sum(${returns.totalRefund}), 0)` })
      .from(returns).leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere).groupBy(returns.customerId),
    database.select({
      customerId: returns.customerId,
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
    }).from(returnItems).innerJoin(returns, eq(returnItems.returnId, returns.id)).innerJoin(products, eq(returnItems.productId, products.id))
      .leftJoin(customers, eq(returns.customerId, customers.id)).where(returnWhere).groupBy(returns.customerId),
    database.select({
      categoryName: sql<string>`coalesce(${categories.name}, 'Khác')`,
      revenue: sql<string>`sum(${orderItems.total})`,
    }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id)).leftJoin(customers, eq(orders.customerId, customers.id)).where(where)
      .groupBy(categories.name).orderBy(desc(sql`sum(${orderItems.total})`)),
    database.select({ status: orders.status, count: sql<number>`count(*)::int` })
      .from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(operationalWhere).groupBy(orders.status),
  ]);

  const summary = summaryRows[0];
  const refunds = refundRows[0];
  const returned = returnedProfitRows[0];
  const financials = calculateDashboardFinancials({
    grossRevenue: Number(summary?.grossRevenue ?? 0),
    grossProfit: Number(profitRows[0]?.grossProfit ?? 0),
    refundTotal: Number(refunds?.refundTotal ?? 0),
    returnedProfit: Number(returned?.returnedProfit ?? 0),
    orderCount: summary?.orderCount ?? 0,
  });
  const costOfGoods = Number(profitRows[0]?.costOfGoods ?? 0) - Number(returned?.returnedCost ?? 0);
  const quantitySold = Number(profitRows[0]?.quantitySold ?? 0) - Number(returned?.returnedQuantity ?? 0);
  const dayMap = createEmptyDays(from, to);
  for (const row of grossByDay) {
    const day = dayMap.get(row.day) ?? emptyDay(row.day);
    day.revenue += Number(row.revenue);
    day.orderCount += row.orderCount;
    dayMap.set(row.day, day);
  }
  for (const row of profitByDay) {
    const day = dayMap.get(row.day);
    if (!day) continue;
    day.grossProfit += Number(row.profit);
    day.costOfGoods += Number(row.cost);
  }
  for (const row of refundsByDay) {
    const day = dayMap.get(row.day) ?? emptyDay(row.day);
    day.refundTotal += Number(row.refund);
    day.revenue -= Number(row.refund);
    day.returnedOrders += row.returnCount;
    dayMap.set(row.day, day);
  }
  for (const row of returnedProfitByDay) {
    const day = dayMap.get(row.day);
    if (!day) continue;
    day.grossProfit -= Number(row.returnedProfit);
    day.costOfGoods -= Number(row.returnedCost);
  }
  const byDay = [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day)).map((day) => ({
    ...day,
    averageOrder: day.orderCount === 0 ? 0 : day.revenue / day.orderCount,
  }));
  const productReturns = new Map(productReturnRows.map((row) => [row.productId, row]));
  const mergedProducts = productSaleRows.map((row) => mergeProductRow(row, productReturns.get(row.productId)));
  const totalProductRevenue = mergedProducts.reduce((sum, row) => sum + row.revenue, 0);
  const topProducts = mergedProducts
    .map((row) => ({ ...row, contribution: totalProductRevenue === 0 ? 0 : (row.revenue / totalProductRevenue) * 100 }))
    .sort((left, right) => right.profit - left.profit)
    .slice(0, 10);
  const customerProfitMap = new Map(customerProfitRows.map((row) => [row.customerId, Number(row.profit)]));
  const customerRefundMap = new Map(customerRefundRows.map((row) => [row.customerId, Number(row.refund)]));
  const customerReturnedProfitMap = new Map(customerReturnedProfitRows.map((row) => [row.customerId, Number(row.returnedProfit)]));
  const allCustomers = customerSaleRows.map((row) => {
    const revenue = Number(row.revenue) - (customerRefundMap.get(row.customerId) ?? 0);
    const profit = (customerProfitMap.get(row.customerId) ?? 0) - (customerReturnedProfitMap.get(row.customerId) ?? 0);
    const createdAt = row.customerCreatedAt ? new Date(row.customerCreatedAt) : null;
    return {
      ...row,
      revenue,
      profit,
      margin: revenue === 0 ? 0 : (profit / revenue) * 100,
      averageOrder: row.orderCount === 0 ? 0 : revenue / row.orderCount,
      segment: createdAt && createdAt >= from && createdAt < to ? "new" as const : "returning" as const,
    };
  });
  const byCustomer = allCustomers.sort((left, right) => right.revenue - left.revenue).slice(0, 10);
  const newCustomerCount = allCustomers.filter((row) => row.customerId && row.segment === "new").length;
  const returningCustomerCount = allCustomers.filter((row) => row.customerId && row.segment === "returning").length;
  const orderStatus = { completed: 0, returned: 0, processing: 0, cancelled: 0 };
  for (const row of statusRows) {
    if (row.status === "completed") orderStatus.completed += row.count;
    else if (row.status === "returned") orderStatus.returned += row.count;
    else if (row.status === "cancelled") orderStatus.cancelled += row.count;
    else orderStatus.processing += row.count;
  }
  const operationalOrderCount = Object.values(orderStatus).reduce((sum, value) => sum + value, 0);
  return {
    summary: {
      revenue: financials.revenue,
      grossRevenue: Number(summary?.grossRevenue ?? 0),
      refundTotal: Number(refunds?.refundTotal ?? 0),
      returnCount: refunds?.returnCount ?? 0,
      collected: Number(summary?.collected ?? 0),
      orderCount: summary?.orderCount ?? 0,
      operationalOrderCount,
      customerCount: summary?.customerCount ?? 0,
      newCustomerCount,
      returningCustomerCount,
      productCount: profitRows[0]?.productCount ?? 0,
      quantitySold,
      grossProfit: financials.grossProfit,
      costOfGoods,
      grossMargin: financials.revenue === 0 ? 0 : (financials.grossProfit / financials.revenue) * 100,
      averageOrder: financials.avgOrder,
      returnRate: operationalOrderCount === 0 ? 0 : (orderStatus.returned / operationalOrderCount) * 100,
    },
    byDay,
    topProducts,
    byCategory,
    byCustomer,
    orderStatus,
  };
}

type DayReport = {
  day: string;
  revenue: number;
  grossProfit: number;
  costOfGoods: number;
  refundTotal: number;
  orderCount: number;
  returnedOrders: number;
  averageOrder: number;
};

function emptyDay(day: string): DayReport {
  return { day, revenue: 0, grossProfit: 0, costOfGoods: 0, refundTotal: 0, orderCount: 0, returnedOrders: 0, averageOrder: 0 };
}

function createEmptyDays(from: Date, to: Date) {
  const days = new Map<string, DayReport>();
  for (let cursor = startOfDay(from); cursor < to; cursor = addDays(cursor, 1)) {
    const day = localDateKey(cursor);
    days.set(day, emptyDay(day));
  }
  return days;
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type CoreReport = Awaited<ReturnType<typeof getCoreReportsForDatabase>>;

function changePercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function comparisonFor(current: CoreReport, previous: CoreReport) {
  return {
    revenue: changePercent(current.summary.revenue, previous.summary.revenue),
    grossProfit: changePercent(current.summary.grossProfit, previous.summary.grossProfit),
    costOfGoods: changePercent(current.summary.costOfGoods, previous.summary.costOfGoods),
    refundTotal: changePercent(current.summary.refundTotal, previous.summary.refundTotal),
    orderCount: changePercent(current.summary.operationalOrderCount, previous.summary.operationalOrderCount),
    averageOrder: changePercent(current.summary.averageOrder, previous.summary.averageOrder),
    productCount: changePercent(current.summary.productCount, previous.summary.productCount),
    quantitySold: changePercent(current.summary.quantitySold, previous.summary.quantitySold),
    customerCount: changePercent(current.summary.customerCount, previous.summary.customerCount),
    newCustomerCount: changePercent(current.summary.newCustomerCount, previous.summary.newCustomerCount),
    returningCustomerCount: changePercent(current.summary.returningCustomerCount, previous.summary.returningCustomerCount),
    grossMargin: current.summary.grossMargin - previous.summary.grossMargin,
    returnRate: current.summary.returnRate - previous.summary.returnRate,
  };
}

export async function getReportsForDatabase(
  database: ReportDatabase,
  storeId: string,
  rangeDays = 30,
  filters: ReportFilters = {},
) {
  const { from, to } = reportBounds(rangeDays, filters);
  const duration = Math.max(86_400_000, to.getTime() - from.getTime());
  const previousTo = new Date(from);
  const previousFrom = new Date(from.getTime() - duration);
  const [current, previous] = await Promise.all([
    getCoreReportsForDatabase(database, storeId, rangeDays, { ...filters, from, to }),
    getCoreReportsForDatabase(database, storeId, rangeDays, { ...filters, from: previousFrom, to: previousTo }),
  ]);
  return {
    rangeDays,
    filters,
    period: {
      from: from.toISOString(),
      toExclusive: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousToExclusive: previousTo.toISOString(),
    },
    ...current,
    previous: {
      summary: previous.summary,
      byDay: previous.byDay,
      orderStatus: previous.orderStatus,
    },
    comparison: comparisonFor(current, previous),
    generatedAt: new Date().toISOString(),
  };
}

export type ReportsData = Awaited<ReturnType<typeof getReports>>;

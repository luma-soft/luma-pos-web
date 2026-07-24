import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  customers,
  orderItems,
  orders,
  products,
  profiles,
  returnItems,
  returns,
} from "@/db/schema";
import { calculateDashboardFinancials } from "@/lib/dashboard/financials";

function daysAgo(n: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export type ReportFilters = {
  customerId?: string;
  customer?: string;
  q?: string;
  from?: Date;
  to?: Date;
};

function reportConditions(rangeDays: number, filters: ReportFilters) {
  const since = filters.from ?? daysAgo(rangeDays - 1);
  const orderDateFilter = filters.to
    ? and(gte(orders.createdAt, since), lt(orders.createdAt, filters.to))
    : gte(orders.createdAt, since);
  const returnDateFilter = filters.to
    ? and(gte(returns.createdAt, since), lt(returns.createdAt, filters.to))
    : gte(returns.createdAt, since);
  const notCancelled = inArray(orders.status, ["completed", "returned"]);
  const customerTerm = filters.customer?.trim() || filters.q?.trim() || "";
  const customerFilter = filters.customerId
    ? eq(orders.customerId, filters.customerId)
    : customerTerm
      ? or(ilike(customers.name, `%${customerTerm}%`), ilike(customers.phone, `%${customerTerm}%`), ilike(customers.code, `%${customerTerm}%`))
      : undefined;
  const where = customerFilter
    ? and(notCancelled, orderDateFilter, customerFilter)
    : and(notCancelled, orderDateFilter);
  const returnCustomerFilter = filters.customerId
    ? eq(returns.customerId, filters.customerId)
    : customerTerm
      ? or(ilike(customers.name, `%${customerTerm}%`), ilike(customers.phone, `%${customerTerm}%`), ilike(customers.code, `%${customerTerm}%`))
      : undefined;
  const returnWhere = returnCustomerFilter
    ? and(returnDateFilter, returnCustomerFilter)
    : returnDateFilter;

  return { where, returnWhere };
}

export async function getReports(rangeDays = 30, filters: ReportFilters = {}) {
  return getReportsForDatabase(db, rangeDays, filters);
}

export async function getReportInvoices(
  rangeDays = 30,
  filters: ReportFilters = {},
  page = 1,
  pageSize = 15,
) {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const { where } = reportConditions(rangeDays, filters);
  const [rows, [countRow]] = await Promise.all([
    db.select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      createdAt: orders.createdAt,
      customerName: sql<string>`coalesce(${customers.name}, 'Khách lẻ')`,
      total: orders.total,
      amountPaid: orders.amountPaid,
      profit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(orders.id, customers.name)
      .orderBy(desc(orders.createdAt))
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize),
    db.select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where),
  ]);
  const total = countRow?.total ?? 0;
  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
    pageCount: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export type ReportInvoiceRow = Awaited<ReturnType<typeof getReportInvoices>>["rows"][number];

export async function getReportsForDatabase(
  database: typeof db,
  rangeDays = 30,
  filters: ReportFilters = {},
) {
  // chỉ đơn bán thật: loại quote/merged/cancelled/draft
  const { where, returnWhere } = reportConditions(rangeDays, filters);

  const [
    summaryRows,
    profitRows,
    refundRows,
    returnedProfitRows,
    grossByDay,
    refundsByDay,
    topProducts,
    byCategory,
    byCustomer,
    byEmployee,
  ] = await Promise.all([
    database.select({
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      collected: sql<string>`coalesce(sum(${orders.amountPaid}), 0)`,
      orderCount: sql<number>`count(*)::int`,
      customerCount: sql<number>`count(distinct ${orders.customerId})::int`,
    }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where),

    database.select({
      grossProfit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where),

    database.select({
      refundTotal: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
    })
      .from(returns)
      .leftJoin(customers, eq(returns.customerId, customers.id))
      .where(returnWhere),

    database.select({
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(returnItems)
      .innerJoin(returns, eq(returnItems.returnId, returns.id))
      .innerJoin(products, eq(returnItems.productId, products.id))
      .leftJoin(customers, eq(returns.customerId, customers.id))
      .where(returnWhere),

    database.select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      orderCount: sql<number>`count(*)::int`,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`),

    database.select({
      day: sql<string>`to_char(${returns.createdAt}, 'YYYY-MM-DD')`,
      refund: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
    })
      .from(returns)
      .leftJoin(customers, eq(returns.customerId, customers.id))
      .where(returnWhere)
      .groupBy(sql`to_char(${returns.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${returns.createdAt}, 'YYYY-MM-DD')`),

    database.select({
      productId: orderItems.productId,
      productName: sql<string>`max(${orderItems.productName})`,
      qtySold: sql<string>`sum(${orderItems.quantity} * ${orderItems.unitMultiplier})`,
      baseUnit: sql<string>`max(${products.baseUnit})`,
      revenue: sql<string>`sum(${orderItems.total})`,
      profit: sql<string>`sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice}))`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(orderItems.productId)
      .orderBy(desc(sql`sum(${orderItems.total})`))
      .limit(10),

    database.select({
      categoryName: sql<string>`coalesce(${categories.name}, 'Khác')`,
      revenue: sql<string>`sum(${orderItems.total})`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(categories.name)
      .orderBy(desc(sql`sum(${orderItems.total})`)),

    // top khách hàng theo doanh thu
    database.select({
      customerId: orders.customerId,
      customerName: sql<string>`coalesce(max(${customers.name}), 'Khách lẻ')`,
      customerType: sql<string | null>`max(${customers.type})`,
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<string>`sum(${orders.total})`,
      remaining: sql<string>`sum(${orders.total} - ${orders.amountPaid})`,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(orders.customerId)
      .orderBy(desc(sql`sum(${orders.total})`))
      .limit(10),

    // theo nhân viên (createdBy)
    database.select({
      sellerId: orders.createdBy,
      sellerName: sql<string>`coalesce(max(${profiles.fullName}), '—')`,
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<string>`sum(${orders.total})`,
      collected: sql<string>`sum(${orders.amountPaid})`,
    })
      .from(orders)
      .leftJoin(profiles, eq(orders.createdBy, profiles.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(orders.createdBy)
      .orderBy(desc(sql`sum(${orders.total})`)),
  ]);

  const summary = summaryRows[0];
  const grossRevenue = Number(summary.revenue);
  const refundTotal = Number(refundRows[0]?.refundTotal ?? 0);
  const financials = calculateDashboardFinancials({
    grossRevenue,
    grossProfit: Number(profitRows[0]?.grossProfit ?? 0),
    refundTotal,
    returnedProfit: Number(returnedProfitRows[0]?.returnedProfit ?? 0),
    orderCount: summary.orderCount,
  });
  const days = new Map<string, { day: string; revenue: number; orderCount: number }>();
  for (const row of grossByDay) {
    days.set(row.day, {
      day: row.day,
      revenue: Number(row.revenue),
      orderCount: row.orderCount,
    });
  }
  for (const row of refundsByDay) {
    const current = days.get(row.day);
    days.set(row.day, {
      day: row.day,
      revenue: (current?.revenue ?? 0) - Number(row.refund),
      orderCount: current?.orderCount ?? 0,
    });
  }
  const byDay = [...days.values()].sort((left, right) => left.day.localeCompare(right.day));

  return {
    rangeDays,
    filters,
    summary: {
      revenue: financials.revenue,
      grossRevenue,
      refundTotal,
      collected: Number(summary.collected),
      orderCount: summary.orderCount,
      customerCount: summary.customerCount,
      grossProfit: financials.grossProfit,
    },
    generatedAt: new Date().toISOString(),
    byDay,
    topProducts,
    byCategory,
    byCustomer,
    byEmployee,
  };
}

export type ReportsData = Awaited<ReturnType<typeof getReports>>;

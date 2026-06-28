import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, customers, orderItems, orders, products, profiles } from "@/db/schema";

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
};

export async function getReports(rangeDays = 30, filters: ReportFilters = {}) {
  const since = daysAgo(rangeDays - 1);
  // chỉ đơn bán thật: loại quote/merged/cancelled/draft
  const notCancelled = inArray(orders.status, ["completed", "returned"]);
  const customerTerm = filters.customer?.trim() || filters.q?.trim() || "";
  const customerFilter = filters.customerId
    ? eq(orders.customerId, filters.customerId)
    : customerTerm
      ? or(ilike(customers.name, `%${customerTerm}%`), ilike(customers.phone, `%${customerTerm}%`), ilike(customers.code, `%${customerTerm}%`))
      : undefined;
  const where = customerFilter
    ? and(notCancelled, gte(orders.createdAt, since), customerFilter)
    : and(notCancelled, gte(orders.createdAt, since));

  const [summaryRows, byDay, topProducts, byCategory, byCustomer, byEmployee] = await Promise.all([
    db.select({
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      collected: sql<string>`coalesce(sum(${orders.amountPaid}), 0)`,
      orderCount: sql<number>`count(*)::int`,
    }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where),

    db.select({
      day: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      orderCount: sql<number>`count(*)::int`,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`),

    db.select({
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

    db.select({
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
    db.select({
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
    db.select({
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
  return {
    rangeDays,
    filters,
    summary: {
      revenue: Number(summary.revenue),
      collected: Number(summary.collected),
      orderCount: summary.orderCount,
    },
    byDay,
    topProducts,
    byCategory,
    byCustomer,
    byEmployee,
  };
}

export type ReportsData = Awaited<ReturnType<typeof getReports>>;

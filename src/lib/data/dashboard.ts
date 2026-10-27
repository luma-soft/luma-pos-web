import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  customers,
  einvoices,
  orderItems,
  orders,
  products,
  returnItems,
  returns,
  stockLevels,
  suppliers,
} from "@/db/schema";
import {
  calculateDashboardFinancials,
  mergeNetRevenueByDay,
} from "@/lib/dashboard/financials";
import { resolveDashboardRange, type DashboardRange } from "@/lib/dashboard/range";
import { stockManagedCategoryCondition } from "@/lib/data/product-stock";

export type { DashboardRange } from "@/lib/dashboard/range";

function rangeStart(range: DashboardRange): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "7d") d.setDate(d.getDate() - 6);
  if (range === "30d") d.setDate(d.getDate() - 29);
  if (range === "month") d.setDate(1);
  return d;
}

export async function getDashboard(
  storeId: string,
  requestedRange?: DashboardRange,
  customDateWindow?: { startAt: Date; endBefore: Date },
) {
  const range = resolveDashboardRange(requestedRange);
  const since = customDateWindow?.startAt ?? rangeStart(range);
  const orderDateFilter = and(
    gte(orders.createdAt, since),
    customDateWindow ? lt(orders.createdAt, customDateWindow.endBefore) : undefined,
  );
  const returnDateFilter = and(
    gte(returns.createdAt, since),
    customDateWindow ? lt(returns.createdAt, customDateWindow.endBefore) : undefined,
  );
  // chỉ đơn bán thật: loại quote/merged/cancelled/draft
  const realSale = inArray(orders.status, ["completed", "returned"]);
  const inRange = and(eq(orders.storeId, storeId), realSale, orderDateFilter);
  const orderBucketKey = range === "today" && !customDateWindow
    ? sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD-HH24')`
    : sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`;
  const orderBucketLabel = range === "today" && !customDateWindow
    ? sql<string>`to_char(${orders.createdAt}, 'HH24"h"')`
    : sql<string>`to_char(${orders.createdAt}, 'DD/MM')`;
  const returnBucketKey = range === "today" && !customDateWindow
    ? sql<string>`to_char(${returns.createdAt}, 'YYYY-MM-DD-HH24')`
    : sql<string>`to_char(${returns.createdAt}, 'YYYY-MM-DD')`;
  const returnBucketLabel = range === "today" && !customDateWindow
    ? sql<string>`to_char(${returns.createdAt}, 'HH24"h"')`
    : sql<string>`to_char(${returns.createdAt}, 'DD/MM')`;
  const returnsInRange = and(
    eq(returns.storeId, storeId),
    returnDateFilter,
    eq(returns.status, "completed"),
  );

  const [
    [agg],
    [profitAgg],
    [refundAgg],
    [returnedProfitAgg],
    [debtAgg],
    [payablesAgg],
    [openOrderAgg],
    lowStockCountRows,
    [eInvoiceAttentionAgg],
    lowStock,
    recentOrders,
    topDebtors,
    topSuppliers,
    grossRevenueSeries,
    refundsSeries,
    grossProfitSeries,
    returnedProfitSeries,
  ] = await Promise.all([
    db.select({
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      orderCount: sql<number>`count(*)::int`,
    }).from(orders).where(inRange),

    // lãi gộp = Σ(thành tiền − SL quy đổi × giá vốn hiện tại)
    db.select({
      profit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(inRange),

    db.select({
      refundTotal: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
    }).from(returns).where(returnsInRange),

    db.select({
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(returnItems)
      .innerJoin(returns, eq(returnItems.returnId, returns.id))
      .innerJoin(products, eq(returnItems.productId, products.id))
      .where(returnsInRange),

    db.select({
      totalDebt: sql<string>`coalesce(sum(${customers.currentDebt}), 0)`,
      debtors: sql<number>`count(*) filter (where ${customers.currentDebt} > 0)::int`,
    }).from(customers).where(and(eq(customers.storeId, storeId), eq(customers.isActive, true))),

    db.select({
      totalDebt: sql<string>`coalesce(sum(${suppliers.currentDebt}), 0)`,
      suppliers: sql<number>`count(*) filter (where ${suppliers.currentDebt} > 0)::int`,
    }).from(suppliers).where(and(eq(suppliers.storeId, storeId), eq(suppliers.isActive, true))),

    db.select({
      count: sql<number>`count(*)::int`,
    }).from(orders).where(and(eq(orders.storeId, storeId), inArray(orders.status, ["draft", "quote", "confirmed", "delivering"]))),

    db.select({ id: products.id })
      .from(products)
      .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(products.storeId, storeId), eq(products.isActive, true), stockManagedCategoryCondition()))
      .groupBy(products.id)
      .having(sql`
        coalesce(sum(${stockLevels.quantity}), 0) <= coalesce(max(${stockLevels.minLevel}), 0)
        and (
          coalesce(max(${stockLevels.minLevel}), 0) > 0
          or coalesce(sum(${stockLevels.quantity}), 0) <= 0
        )
      `),

    db.select({
      count: sql<number>`count(*)::int`,
    }).from(einvoices).where(inArray(einvoices.status, ["draft", "error"])),

    db.select({
      id: products.id,
      name: products.name, variantName: products.variantName, specs: products.specs,
      baseUnit: products.baseUnit,
      categoryName: categories.name,
      totalStock: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)`,
      minLevel: sql<string>`coalesce(max(${stockLevels.minLevel}), 0)`,
    })
      .from(products)
      .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(products.storeId, storeId), eq(products.isActive, true), stockManagedCategoryCondition()))
      .groupBy(products.id, categories.name)
      .having(sql`
        coalesce(sum(${stockLevels.quantity}), 0) <= coalesce(max(${stockLevels.minLevel}), 0)
        and (
          coalesce(max(${stockLevels.minLevel}), 0) > 0
          or coalesce(sum(${stockLevels.quantity}), 0) <= 0
        )
      `)
      .orderBy(
        sql`case when coalesce(sum(${stockLevels.quantity}), 0) <= 0 then 0 else 1 end`,
        sql`coalesce(sum(${stockLevels.quantity}), 0) / nullif(coalesce(max(${stockLevels.minLevel}), 0), 0)`,
      )
      .limit(5),

    db.select({
      id: orders.id,
      code: orders.code,
      total: orders.total,
      amountPaid: orders.amountPaid,
      paymentStatus: orders.paymentStatus,
      status: orders.status,
      projectName: orders.projectName,
      createdAt: orders.createdAt,
      customerId: orders.customerId,
      customerName: customers.name,
      customerType: customers.type,
      itemCount: sql<number>`(
        select count(*)::int from ${orderItems}
        where ${orderItems.orderId} = ${orders.id}
          and ${orderItems.storeId} = ${storeId}
      )`,
      productNames: sql<string>`coalesce((
        select string_agg(${orderItems.productName}, ', ' order by ${orderItems.id})
        from ${orderItems}
        where ${orderItems.orderId} = ${orders.id}
          and ${orderItems.storeId} = ${storeId}
      ), '')`,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(orders.storeId, storeId), realSale))
      .orderBy(desc(orders.createdAt))
      .limit(5),

    db.select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      currentDebt: customers.currentDebt,
      debtLimit: customers.debtLimit,
    })
      .from(customers)
      .where(and(eq(customers.storeId, storeId), eq(customers.isActive, true), sql`${customers.currentDebt} > 0`))
      .orderBy(desc(customers.currentDebt))
      .limit(5),

    db.select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone,
      address: suppliers.address,
      currentDebt: suppliers.currentDebt,
    })
      .from(suppliers)
      .where(and(eq(suppliers.storeId, storeId), eq(suppliers.isActive, true), sql`${suppliers.currentDebt} > 0`))
      .orderBy(desc(suppliers.currentDebt))
      .limit(5),

    db.select({
      key: orderBucketKey,
      label: orderBucketLabel,
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
    })
      .from(orders)
      .where(inRange)
      .groupBy(orderBucketKey, orderBucketLabel)
      .orderBy(orderBucketKey),

    db.select({
      key: returnBucketKey,
      label: returnBucketLabel,
      refund: sql<string>`coalesce(sum(${returns.totalRefund}), 0)`,
    })
      .from(returns)
      .where(returnsInRange)
      .groupBy(returnBucketKey, returnBucketLabel)
      .orderBy(returnBucketKey),

    db.select({
      key: orderBucketKey,
      label: orderBucketLabel,
      grossProfit: sql<string>`coalesce(sum(${orderItems.total} - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(inRange)
      .groupBy(orderBucketKey, orderBucketLabel)
      .orderBy(orderBucketKey),

    db.select({
      key: returnBucketKey,
      label: returnBucketLabel,
      returnedProfit: sql<string>`coalesce(sum(${returnItems.total} - (${returnItems.quantity} * ${returnItems.unitMultiplier} * ${products.costPrice})), 0)`,
    })
      .from(returnItems)
      .innerJoin(returns, eq(returnItems.returnId, returns.id))
      .innerJoin(products, eq(returnItems.productId, products.id))
      .where(returnsInRange)
      .groupBy(returnBucketKey, returnBucketLabel)
      .orderBy(returnBucketKey),
  ]);

  const financials = calculateDashboardFinancials({
    grossRevenue: Number(agg.revenue),
    grossProfit: Number(profitAgg.profit),
    refundTotal: Number(refundAgg.refundTotal),
    returnedProfit: Number(returnedProfitAgg.returnedProfit),
    orderCount: agg.orderCount,
  });

  return {
    range,
    revenue: financials.revenue,
    orderCount: agg.orderCount,
    avgOrder: financials.avgOrder,
    grossProfit: financials.grossProfit,
    costOfGoods: financials.costOfGoods,
    marginPct: financials.marginPct,
    debt: { total: Number(debtAgg.totalDebt), debtors: debtAgg.debtors },
    payables: { total: Number(payablesAgg.totalDebt), suppliers: payablesAgg.suppliers },
    openOrderCount: openOrderAgg.count,
    lowStockCount: lowStockCountRows.length,
    eInvoiceAttentionCount: eInvoiceAttentionAgg.count,
    lowStock,
    recentOrders,
    topDebtors,
    topSuppliers,
    revenueByDay: collapseRevenueByDay(grossRevenueSeries, refundsSeries),
    analyticsSeries: mergeAnalyticsSeries(
      grossRevenueSeries,
      refundsSeries,
      grossProfitSeries,
      returnedProfitSeries,
    ),
    recentActivity: recentOrders.map((order) => ({
      id: `order:${order.id}`,
      kind: "order",
      occurredAt: order.createdAt.toISOString(),
      title: order.code,
      description: String(order.total),
      entityId: order.id,
    })),
  };
}

type SeriesRow = { key: string; label: string };

function mergeAnalyticsSeries(
  sales: Array<SeriesRow & { revenue: string | number }>,
  refunds: Array<SeriesRow & { refund: string | number }>,
  profits: Array<SeriesRow & { grossProfit: string | number }>,
  returnedProfits: Array<SeriesRow & { returnedProfit: string | number }>,
) {
  const rows = new Map<string, {
    key: string;
    label: string;
    revenue: number;
    grossProfit: number;
  }>();
  const rowFor = (row: SeriesRow) => {
    const current = rows.get(row.key) ?? {
      key: row.key,
      label: row.label,
      revenue: 0,
      grossProfit: 0,
    };
    rows.set(row.key, current);
    return current;
  };
  for (const row of sales) rowFor(row).revenue += Number(row.revenue);
  for (const row of refunds) rowFor(row).revenue -= Number(row.refund);
  for (const row of profits) rowFor(row).grossProfit += Number(row.grossProfit);
  for (const row of returnedProfits) {
    rowFor(row).grossProfit -= Number(row.returnedProfit);
  }
  return [...rows.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function collapseRevenueByDay(
  sales: Array<SeriesRow & { revenue: string | number }>,
  refunds: Array<SeriesRow & { refund: string | number }>,
) {
  const grossByDay = new Map<string, number>();
  const refundsByDay = new Map<string, number>();
  for (const row of sales) {
    const day = row.key.slice(0, 10);
    grossByDay.set(day, (grossByDay.get(day) ?? 0) + Number(row.revenue));
  }
  for (const row of refunds) {
    const day = row.key.slice(0, 10);
    refundsByDay.set(day, (refundsByDay.get(day) ?? 0) + Number(row.refund));
  }
  return mergeNetRevenueByDay(
    [...grossByDay].map(([day, revenue]) => ({
      day,
      dow: ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
      revenue,
    })),
    [...refundsByDay].map(([day, refund]) => ({
      day,
      dow: ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
      refund,
    })),
  );
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

export { categoryEmoji } from "@/lib/category-emoji";

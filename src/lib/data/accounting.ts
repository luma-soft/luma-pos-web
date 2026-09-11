import { and, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cashTransactions,
  customers,
  einvoices,
  orderItems,
  orders,
  otherTaxObligations,
  paymentBankAccounts,
  products,
  profiles,
  purchaseOrders,
  returnItems,
  returns,
  stockMovements,
  suppliers,
  taxDeclarations,
  warehouses,
} from "@/db/schema";
import type { StorePrefs } from "@/lib/schemas/settings";

export type RevenueBookFilters = {
  from: Date;
  to: Date;
  q?: string;
  document?: "all" | "sale" | "return";
  einvoice?: "all" | "issued" | "none";
  page: number;
  pageSize: number;
};

export type RevenueBookRow = {
  id: string;
  sourceType: "sale" | "return";
  sourceId: string;
  code: string;
  date: Date;
  description: string;
  amount: number;
  salesChannel: string;
  einvoiceNumber: string | null;
  einvoiceSerial: string | null;
  createdByName: string | null;
  activityName: string | null;
  vatRate: number | null;
  pitRate: number | null;
};

export async function getRevenueBook(
  storeId: string,
  tax: StorePrefs["tax"],
  filters: RevenueBookFilters,
) {
  const safePage = Math.max(1, Math.floor(filters.page));
  const safePageSize = Math.min(50_000, Math.max(1, Math.floor(filters.pageSize)));
  const take = safePage * safePageSize;
  const term = filters.q?.trim();
  const invoiceCondition = filters.einvoice === "issued"
    ? eq(einvoices.status, "issued")
    : filters.einvoice === "none"
      ? or(isNull(einvoices.id), ne(einvoices.status, "issued"))
      : undefined;

  const saleWhere = and(
    eq(orders.storeId, storeId),
    eq(orders.documentType, "sale"),
    inArray(orders.status, ["completed", "returned"]),
    gte(orders.createdAt, filters.from),
    lt(orders.createdAt, filters.to),
    invoiceCondition,
    term ? or(
      ilike(orders.code, `%${term}%`),
      ilike(customers.name, `%${term}%`),
      ilike(customers.phone, `%${term}%`),
    ) : undefined,
  );
  const returnWhere = and(
    eq(returns.storeId, storeId),
    eq(returns.status, "completed"),
    gte(returns.createdAt, filters.from),
    lt(returns.createdAt, filters.to),
    invoiceCondition,
    term ? or(
      ilike(returns.code, `%${term}%`),
      ilike(returns.sourceInvoiceCode, `%${term}%`),
      ilike(customers.name, `%${term}%`),
      ilike(customers.phone, `%${term}%`),
    ) : undefined,
  );

  const salesQuery = db.select({
    id: orders.id,
    sourceId: orders.id,
    code: orders.code,
    date: orders.createdAt,
    description: sql<string>`concat('Ghi nhận doanh thu bán hàng và thuế cho ', coalesce(${customers.name}, 'Khách lẻ'))`,
    amount: orders.total,
    einvoiceNumber: einvoices.number,
    einvoiceSerial: einvoices.serial,
    createdByName: profiles.fullName,
  })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(einvoices, eq(einvoices.orderId, orders.id))
    .leftJoin(profiles, eq(orders.createdBy, profiles.id))
    .where(saleWhere)
    .orderBy(desc(orders.createdAt))
    .limit(take);

  const returnsQuery = db.select({
    id: returns.id,
    sourceId: returns.id,
    code: returns.code,
    date: returns.createdAt,
    description: sql<string>`concat('Điều chỉnh giảm doanh thu do trả hàng', case when ${returns.sourceInvoiceCode} is null then '' else concat(' từ ', ${returns.sourceInvoiceCode}) end)`,
    amount: sql<string>`-${returns.totalRefund}`,
    einvoiceNumber: einvoices.number,
    einvoiceSerial: einvoices.serial,
    createdByName: profiles.fullName,
  })
    .from(returns)
    .leftJoin(orders, eq(returns.orderId, orders.id))
    .leftJoin(customers, eq(returns.customerId, customers.id))
    .leftJoin(einvoices, eq(einvoices.orderId, orders.id))
    .leftJoin(profiles, eq(returns.createdBy, profiles.id))
    .where(returnWhere)
    .orderBy(desc(returns.createdAt))
    .limit(take);

  const includeSales = filters.document !== "return";
  const includeReturns = filters.document !== "sale";
  const [saleRows, returnRows, [saleCount], [returnCount]] = await Promise.all([
    includeSales ? salesQuery : Promise.resolve([]),
    includeReturns ? returnsQuery : Promise.resolve([]),
    includeSales
      ? db.select({ count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${orders.total}), 0)` })
        .from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).leftJoin(einvoices, eq(einvoices.orderId, orders.id)).where(saleWhere)
      : Promise.resolve([{ count: 0, amount: "0" }]),
    includeReturns
      ? db.select({ count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${returns.totalRefund}), 0)` })
        .from(returns).leftJoin(orders, eq(returns.orderId, orders.id)).leftJoin(customers, eq(returns.customerId, customers.id)).leftJoin(einvoices, eq(einvoices.orderId, orders.id)).where(returnWhere)
      : Promise.resolve([{ count: 0, amount: "0" }]),
  ]);

  const enabledActivities = tax.businessActivities.filter((activity) => activity.enabled);
  const defaultActivity = tax.calculationMethod === "revenue_percentage" ? null : enabledActivities.length === 1 ? enabledActivities[0] : null;
  const [saleActivityRows, returnActivityRows] = tax.calculationMethod === "revenue_percentage"
    ? await Promise.all([
      saleRows.length === 0 ? Promise.resolve([]) : db.select({
        sourceId: orderItems.orderId,
        activityId: orderItems.taxActivityId,
        activityName: sql<string>`coalesce(${orderItems.taxActivityName}, 'Chưa phân loại')`,
        vatRate: sql<string>`coalesce(${orderItems.vatRevenueRate}, 0)`,
        pitRate: sql<string>`coalesce(${orderItems.pitRevenueRate}, 0)`,
        amount: sql<string>`coalesce(sum(${orderItems.total}), 0)`,
      }).from(orderItems).where(inArray(orderItems.orderId, saleRows.map((row) => row.id)))
        .groupBy(orderItems.orderId, orderItems.taxActivityId, orderItems.taxActivityName, orderItems.vatRevenueRate, orderItems.pitRevenueRate),
      returnRows.length === 0 ? Promise.resolve([]) : db.select({
        sourceId: returnItems.returnId,
        activityId: returnItems.taxActivityId,
        activityName: sql<string>`coalesce(${returnItems.taxActivityName}, 'Chưa phân loại')`,
        vatRate: sql<string>`coalesce(${returnItems.vatRevenueRate}, 0)`,
        pitRate: sql<string>`coalesce(${returnItems.pitRevenueRate}, 0)`,
        amount: sql<string>`coalesce(sum(${returnItems.total}), 0)`,
      }).from(returnItems).where(inArray(returnItems.returnId, returnRows.map((row) => row.id)))
        .groupBy(returnItems.returnId, returnItems.taxActivityId, returnItems.taxActivityName, returnItems.vatRevenueRate, returnItems.pitRevenueRate),
    ])
    : [[], []];
  const saleActivities = groupActivityRows(saleActivityRows);
  const returnActivities = groupActivityRows(returnActivityRows);
  const combined: RevenueBookRow[] = [
    ...saleRows.flatMap((row) => expandRevenueRow(row, "sale", defaultActivity, saleActivities.get(row.id))),
    ...returnRows.flatMap((row) => expandRevenueRow(row, "return", defaultActivity, returnActivities.get(row.id))),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  const offset = (safePage - 1) * safePageSize;
  const total = Number(saleCount?.count ?? 0) + Number(returnCount?.count ?? 0);

  return {
    rows: combined.slice(offset, offset + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    pageCount: Math.max(1, Math.ceil(total / safePageSize)),
    totalRevenue: Number(saleCount?.amount ?? 0) - Number(returnCount?.amount ?? 0),
    activityNeedsClassification: false,
  };
}

export async function getTaxActivityRevenue(storeId: string, from: Date, to: Date) {
  const sales = await db.select({
    activityId: orderItems.taxActivityId,
    activityName: sql<string>`coalesce(${orderItems.taxActivityName}, 'Chưa phân loại')`,
    vatRate: sql<string>`coalesce(${orderItems.vatRevenueRate}, 0)`,
    pitRate: sql<string>`coalesce(${orderItems.pitRevenueRate}, 0)`,
    revenue: sql<string>`coalesce(sum(${orderItems.total}), 0)`,
  }).from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.storeId, storeId), eq(orders.documentType, "sale"), inArray(orders.status, ["completed", "returned"]), gte(orders.createdAt, from), lt(orders.createdAt, to)))
    .groupBy(orderItems.taxActivityId, orderItems.taxActivityName, orderItems.vatRevenueRate, orderItems.pitRevenueRate);
  const refunds = await db.select({
    activityId: returnItems.taxActivityId,
    activityName: sql<string>`coalesce(${returnItems.taxActivityName}, 'Chưa phân loại')`,
    vatRate: sql<string>`coalesce(${returnItems.vatRevenueRate}, 0)`,
    pitRate: sql<string>`coalesce(${returnItems.pitRevenueRate}, 0)`,
    revenue: sql<string>`coalesce(sum(${returnItems.total}), 0)`,
  }).from(returnItems)
    .innerJoin(returns, eq(returnItems.returnId, returns.id))
    .where(and(eq(returns.storeId, storeId), eq(returns.status, "completed"), gte(returns.createdAt, from), lt(returns.createdAt, to)))
    .groupBy(returnItems.taxActivityId, returnItems.taxActivityName, returnItems.vatRevenueRate, returnItems.pitRevenueRate);
  const grouped = new Map<string, { activityId: string | null; activityName: string; vatRate: number; pitRate: number; revenue: number }>();
  for (const row of sales) {
    const key = `${row.activityId ?? "_"}:${row.vatRate}:${row.pitRate}`;
    grouped.set(key, { activityId: row.activityId, activityName: row.activityName, vatRate: Number(row.vatRate), pitRate: Number(row.pitRate), revenue: Number(row.revenue) });
  }
  for (const row of refunds) {
    const key = `${row.activityId ?? "_"}:${row.vatRate}:${row.pitRate}`;
    const current = grouped.get(key) ?? { activityId: row.activityId, activityName: row.activityName, vatRate: Number(row.vatRate), pitRate: Number(row.pitRate), revenue: 0 };
    current.revenue -= Number(row.revenue);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.revenue - a.revenue);
}

export async function getAccountingAuxiliaryBooks(storeId: string, from: Date, to: Date) {
  const [cash, inventory, purchases, expenses, taxes, bankAccounts, declarations] = await Promise.all([
    db.select({ id: cashTransactions.id, date: cashTransactions.createdAt, code: cashTransactions.code, type: cashTransactions.type, fund: cashTransactions.fund, category: cashTransactions.category, description: cashTransactions.note, amount: cashTransactions.amount })
      .from(cashTransactions).where(and(eq(cashTransactions.storeId, storeId), gte(cashTransactions.createdAt, from), lt(cashTransactions.createdAt, to))).orderBy(desc(cashTransactions.createdAt)).limit(5000),
    db.select({ id: stockMovements.id, date: stockMovements.createdAt, type: stockMovements.type, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost, description: stockMovements.note, productName: products.name, sku: products.sku, unit: products.baseUnit, warehouseName: warehouses.name })
      .from(stockMovements).innerJoin(products, eq(stockMovements.productId, products.id)).innerJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
      .where(and(eq(stockMovements.storeId, storeId), gte(stockMovements.createdAt, from), lt(stockMovements.createdAt, to))).orderBy(desc(stockMovements.createdAt)).limit(5000),
    db.select({ id: purchaseOrders.id, date: purchaseOrders.createdAt, code: purchaseOrders.code, description: sql<string>`concat('Mua hàng từ ', ${suppliers.name})`, amount: purchaseOrders.total })
      .from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(and(eq(purchaseOrders.storeId, storeId), eq(purchaseOrders.status, "received"), gte(purchaseOrders.createdAt, from), lt(purchaseOrders.createdAt, to))).orderBy(desc(purchaseOrders.createdAt)).limit(5000),
    db.select({ id: cashTransactions.id, date: cashTransactions.createdAt, code: cashTransactions.code, description: cashTransactions.note, amount: cashTransactions.amount })
      .from(cashTransactions).where(and(eq(cashTransactions.storeId, storeId), eq(cashTransactions.type, "out"), inArray(cashTransactions.category, ["expense", "other"]), gte(cashTransactions.createdAt, from), lt(cashTransactions.createdAt, to))).orderBy(desc(cashTransactions.createdAt)).limit(5000),
    db.select().from(otherTaxObligations).where(and(eq(otherTaxObligations.storeId, storeId), gte(otherTaxObligations.occurredOn, dateValue(from)), lt(otherTaxObligations.occurredOn, dateValue(to)))).orderBy(desc(otherTaxObligations.occurredOn)),
    db.select({ id: paymentBankAccounts.id, bankCode: paymentBankAccounts.bankCode, accountNumber: paymentBankAccounts.accountNumber, accountName: paymentBankAccounts.accountName, status: paymentBankAccounts.taxRegistrationStatus, registeredAt: paymentBankAccounts.taxRegisteredAt, enabled: paymentBankAccounts.enabled }).from(paymentBankAccounts).where(eq(paymentBankAccounts.storeId, storeId)).orderBy(desc(paymentBankAccounts.isDefault)),
    db.select().from(taxDeclarations).where(eq(taxDeclarations.storeId, storeId)).orderBy(desc(taxDeclarations.periodKey)),
  ]);
  return {
    cash: cash.map((row) => ({ ...row, amount: Number(row.amount) })),
    inventory: inventory.map((row) => ({ ...row, quantity: Number(row.quantity), unitCost: row.unitCost == null ? null : Number(row.unitCost) })),
    purchases: purchases.map((row) => ({ ...row, amount: Number(row.amount) })),
    expenses: expenses.map((row) => ({ ...row, amount: Number(row.amount) })),
    taxes: taxes.map((row) => ({ ...row, payableAmount: Number(row.payableAmount), paidAmount: Number(row.paidAmount) })),
    bankAccounts,
    declarations: declarations.map((row) => ({ ...row, revenue: Number(row.revenue), vatAmount: Number(row.vatAmount), pitAmount: Number(row.pitAmount) })),
  };
}

export async function getTaxClassificationProducts(storeId: string) {
  return db.select({ id: products.id, sku: products.sku, name: products.name, taxActivityId: products.taxActivityId })
    .from(products).where(and(eq(products.storeId, storeId), eq(products.isActive, true), eq(products.isVariantParent, false))).orderBy(products.name).limit(5000);
}

function dateValue(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function toRevenueRow(
  row: {
    id: string;
    sourceId: string;
    code: string;
    date: Date;
    description: string;
    amount: string;
    einvoiceNumber: string | null;
    einvoiceSerial: string | null;
    createdByName: string | null;
  },
  sourceType: "sale" | "return",
  activity: StorePrefs["tax"]["businessActivities"][number] | null,
): RevenueBookRow {
  return {
    ...row,
    sourceType,
    amount: Number(row.amount),
    salesChannel: "Bán trực tiếp",
    activityName: activity?.name ?? null,
    vatRate: activity?.vatRate ?? null,
    pitRate: activity?.pitRate ?? null,
  };
}

type ActivityAllocation = {
  activityId: string | null;
  activityName: string;
  vatRate: number;
  pitRate: number;
  amount: number;
};

function groupActivityRows(rows: Array<{ sourceId: string; activityId: string | null; activityName: string; vatRate: string; pitRate: string; amount: string }>) {
  const grouped = new Map<string, ActivityAllocation[]>();
  for (const row of rows) {
    const current = grouped.get(row.sourceId) ?? [];
    current.push({ activityId: row.activityId, activityName: row.activityName, vatRate: Number(row.vatRate), pitRate: Number(row.pitRate), amount: Number(row.amount) });
    grouped.set(row.sourceId, current);
  }
  return grouped;
}

function expandRevenueRow(
  row: Parameters<typeof toRevenueRow>[0],
  sourceType: "sale" | "return",
  defaultActivity: StorePrefs["tax"]["businessActivities"][number] | null,
  allocations?: ActivityAllocation[],
) {
  if (!allocations?.length) return [toRevenueRow(row, sourceType, defaultActivity)];
  return allocations.map((allocation, index) => ({
    ...toRevenueRow({ ...row, id: `${row.id}-${allocation.activityId ?? "unclassified"}-${index}`, amount: String(sourceType === "return" ? -allocation.amount : allocation.amount) }, sourceType, null),
    activityName: allocation.activityName,
    vatRate: allocation.vatRate,
    pitRate: allocation.pitRate,
  }));
}

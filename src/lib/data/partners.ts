import { and, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  customerConsents,
  customerReceivableEntries,
  customers,
  orderItems,
  orders,
  payments,
  profiles,
  returnItems,
  returns,
  suppliers,
  warehouses,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";
import { getSupplierPayableOverview } from "@/lib/data/supplier-payables";

export const PARTNERS_PAGE_SIZE = 20;

const CUSTOMER_TYPES = ["retail", "wholesale", "contractor", "agent"] as const;
type CustomerType = (typeof CUSTOMER_TYPES)[number];

export type CustomerFilters = {
  customerId?: string;
  q?: string;
  type?: string;
  owing?: boolean;
  page?: number;
  pageSize?: number;
  createdFrom?: string;
  createdTo?: string;
  lastTxFrom?: string;
  lastTxTo?: string;
  totalFrom?: string;
  totalTo?: string;
  debtFrom?: string;
  debtTo?: string;
};

export type CustomerSalesHistoryRow = {
  id: string;
  kind: "order" | "return";
  code: string;
  orderId: string | null;
  createdAt: Date;
  sellerName: string | null;
  total: string;
  status: string;
  itemCount: number;
  paymentStatus: string;
  paymentMethod: string;
  productNames: string;
};

export type CustomerDebtLedgerRow = {
  id: string;
  kind: "sale" | "payment" | "return" | "adjustment" | "discount";
  code: string;
  orderId: string | null;
  createdAt: Date;
  typeLabel: string;
  value: number;
  balance: number;
  reason: string | null;
};

function isCustomerType(value?: string): value is CustomerType {
  return CUSTOMER_TYPES.includes(value as CustomerType);
}

function parseDateBound(value?: string, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseMoneyBound(value?: string) {
  if (!value) return undefined;
  const normalized = value.replace(/[,\s]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function buildCustomerConditions(storeId: string, filters: CustomerFilters) {
  const conditions: SQL[] = [
    eq(customers.storeId, storeId),
    eq(customers.isActive, true),
  ];

  if (filters.customerId) conditions.push(eq(customers.id, filters.customerId));

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(customers.name, q), accentInsensitiveLike(customers.phone, q), accentInsensitiveLike(customers.code, q));
    if (c) conditions.push(c);
  }
  if (isCustomerType(filters.type)) conditions.push(eq(customers.type, filters.type));
  if (filters.owing) conditions.push(sql`${customers.currentDebt} > 0`);

  const createdFrom = parseDateBound(filters.createdFrom);
  const createdTo = parseDateBound(filters.createdTo, true);
  if (createdFrom) conditions.push(gte(customers.createdAt, createdFrom));
  if (createdTo) conditions.push(lte(customers.createdAt, createdTo));

  const totalFrom = parseMoneyBound(filters.totalFrom);
  const totalTo = parseMoneyBound(filters.totalTo);
  if (totalFrom !== undefined) conditions.push(sql`${customers.totalSpent} >= ${totalFrom.toFixed(2)}`);
  if (totalTo !== undefined) conditions.push(sql`${customers.totalSpent} <= ${totalTo.toFixed(2)}`);

  const debtFrom = parseMoneyBound(filters.debtFrom);
  const debtTo = parseMoneyBound(filters.debtTo);
  if (debtFrom !== undefined) conditions.push(sql`${customers.currentDebt} >= ${debtFrom.toFixed(2)}`);
  if (debtTo !== undefined) conditions.push(sql`${customers.currentDebt} <= ${debtTo.toFixed(2)}`);

  const lastTxFrom = parseDateBound(filters.lastTxFrom);
  const lastTxTo = parseDateBound(filters.lastTxTo, true);
  if (lastTxFrom || lastTxTo) {
    const lastTx = sql`(
      select max(${orders.createdAt})
      from ${orders}
      where ${orders.customerId} = ${customers.id}
        and ${orders.storeId} = ${storeId}
        and ${orders.status} in ('completed', 'returned')
    )`;
    if (lastTxFrom) conditions.push(sql`${lastTx} >= ${lastTxFrom}`);
    if (lastTxTo) conditions.push(sql`${lastTx} <= ${lastTxTo}`);
  }

  return conditions;
}

const saleOrderStatus = sql`${orders.status} in ('completed', 'returned')`;
const customerHistoryOrderStatus = sql`${orders.status} in ('completed', 'returned', 'cancelled')`;

export async function getCustomers(
  storeId: string,
  filters: CustomerFilters = {},
  options: { includeHistory?: boolean } = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions = buildCustomerConditions(storeId, filters);
  const where = and(...conditions);

  const [baseRows, [{ total }], [moneyAgg], [grossAgg]] = await Promise.all([
    db
      .select({
        id: customers.id,
        code: customers.code,
        name: customers.name,
        phone: customers.phone,
        zaloUserId: customers.zaloUserId,
        email: customers.email,
        address: customers.address,
        type: customers.type,
        taxCode: customers.taxCode,
        debtLimit: customers.debtLimit,
        currentDebt: customers.currentDebt,
        totalSpent: customers.totalSpent,
        portalToken: customers.portalToken,
        note: customers.note,
        isActive: customers.isActive,
        createdAt: customers.createdAt,
        createdByName: sql<string | null>`null`,
        customerGroupName: sql<string | null>`null`,
        birthday: sql<Date | null>`null`,
        gender: sql<string | null>`null`,
        facebook: sql<string | null>`null`,
        lastTransactionAt: sql<Date | null>`(
          select max(${orders.createdAt})
          from ${orders}
          where ${orders.customerId} = ${customers.id}
            and ${orders.storeId} = ${storeId}
            and ${orders.status} in ('completed', 'returned')
        )`,
        orderCount: sql<number>`(
          select count(*)::int
          from ${orders}
          where ${orders.customerId} = ${customers.id}
            and ${orders.storeId} = ${storeId}
        )`,
        consentStatus: customerConsents.status,
        consentPurposes: customerConsents.purposes,
        consentUpdatedAt: customerConsents.updatedAt,
      })
      .from(customers)
      .leftJoin(customerConsents, eq(customerConsents.customerId, customers.id))
      .where(where)
      .orderBy(desc(customers.currentDebt), desc(customers.createdAt))
      .limit(size).offset((page - 1) * size),
    db.select({ total: count() }).from(customers).where(where),
    db
      .select({
        totalDebt: sql<string>`coalesce(sum(${customers.currentDebt}), 0)`,
        totalNetSales: sql<string>`coalesce(sum(${customers.totalSpent}), 0)`,
        retailCount: sql<number>`sum(case when ${customers.type} = 'retail' then 1 else 0 end)::int`,
        wholesaleCount: sql<number>`sum(case when ${customers.type} = 'wholesale' then 1 else 0 end)::int`,
        contractorCount: sql<number>`sum(case when ${customers.type} = 'contractor' then 1 else 0 end)::int`,
        agentCount: sql<number>`sum(case when ${customers.type} = 'agent' then 1 else 0 end)::int`,
        owingCount: sql<number>`sum(case when ${customers.currentDebt} > 0 then 1 else 0 end)::int`,
        consentGrantedCount: sql<number>`sum(case when ${customerConsents.status} = 'granted' then 1 else 0 end)::int`,
      })
      .from(customers)
      .leftJoin(customerConsents, eq(customerConsents.customerId, customers.id))
      .where(where),
    db
      .select({
        totalGrossSales: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(orders.storeId, storeId), where, saleOrderStatus)),
  ]);

  const customerIds = baseRows.map((row) => row.id);
  let rows = baseRows.map((row) => ({
    ...row,
    grossSales: "0",
    salesHistory: [] as CustomerSalesHistoryRow[],
    debtLedger: [] as CustomerDebtLedgerRow[],
  }));

  const summary = {
    rows,
    total,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
    totalDebt: Number(moneyAgg.totalDebt),
    totalGrossSales: Number(grossAgg.totalGrossSales),
    totalNetSales: Number(moneyAgg.totalNetSales),
    stats: {
      retail: Number(moneyAgg.retailCount),
      wholesale: Number(moneyAgg.wholesaleCount),
      contractor: Number(moneyAgg.contractorCount),
      agent: Number(moneyAgg.agentCount),
      owing: Number(moneyAgg.owingCount),
      consentGranted: Number(moneyAgg.consentGrantedCount),
    },
  };

  if (options.includeHistory === false || customerIds.length === 0) {
    return summary;
  }

  if (customerIds.length > 0) {
    const [grossRows, orderRows, returnRows, paymentRows, receivableEntryRows] = await Promise.all([
      db
        .select({
          customerId: orders.customerId,
          grossSales: sql<string>`coalesce(sum(${orders.total}), 0)`,
        })
        .from(orders)
        .where(and(inArray(orders.customerId, customerIds), saleOrderStatus))
        .groupBy(orders.customerId),
      db
        .select({
          customerId: orders.customerId,
          id: orders.id,
          code: orders.code,
          status: orders.status,
          total: orders.total,
          amountPaid: orders.amountPaid,
          paymentStatus: orders.paymentStatus,
          paymentMethod: sql<string>`coalesce((
            select ${payments.method}::text
            from ${payments}
            where ${payments.orderId} = ${orders.id}
            order by ${payments.createdAt} desc
            limit 1
          ), '')`,
          productNames: sql<string>`coalesce((
            select string_agg(distinct ${orderItems.productName}, ' | ')
            from ${orderItems}
            where ${orderItems.orderId} = ${orders.id}
          ), '')`,
          itemCount: sql<number>`(
            select count(*)::int
            from ${orderItems}
            where ${orderItems.orderId} = ${orders.id}
          )`,
          createdAt: orders.createdAt,
          sellerName: profiles.fullName,
        })
        .from(orders)
        .leftJoin(profiles, eq(orders.createdBy, profiles.id))
        .where(and(inArray(orders.customerId, customerIds), customerHistoryOrderStatus))
        .orderBy(desc(orders.createdAt))
        .limit(customerIds.length * 30),
      db
        .select({
          customerId: returns.customerId,
          id: returns.id,
          code: returns.code,
          orderId: returns.orderId,
          totalRefund: returns.totalRefund,
          refundMethod: returns.refundMethod,
          productNames: sql<string>`coalesce((
            select string_agg(distinct ${returnItems.productName}, ' | ')
            from ${returnItems}
            where ${returnItems.returnId} = ${returns.id}
          ), '')`,
          itemCount: sql<number>`(
            select count(*)::int
            from ${returnItems}
            where ${returnItems.returnId} = ${returns.id}
          )`,
          createdAt: returns.createdAt,
          sellerName: profiles.fullName,
        })
        .from(returns)
        .leftJoin(profiles, eq(returns.createdBy, profiles.id))
        .where(and(inArray(returns.customerId, customerIds), eq(returns.status, "completed")))
        .orderBy(desc(returns.createdAt))
        .limit(customerIds.length * 30),
      db
        .select({
          customerId: orders.customerId,
          id: payments.id,
          orderId: orders.id,
          orderCode: orders.code,
          amount: payments.amount,
          method: payments.method,
          reference: payments.reference,
          note: payments.note,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(inArray(orders.customerId, customerIds))
        .orderBy(desc(payments.createdAt))
        .limit(customerIds.length * 60),
      db
        .select({
          customerId: customerReceivableEntries.customerId,
          id: customerReceivableEntries.id,
          code: customerReceivableEntries.code,
          orderId: customerReceivableEntries.orderId,
          type: customerReceivableEntries.type,
          amount: customerReceivableEntries.amount,
          reason: customerReceivableEntries.reason,
          createdAt: customerReceivableEntries.createdAt,
        })
        .from(customerReceivableEntries)
        .where(inArray(customerReceivableEntries.customerId, customerIds))
        .orderBy(desc(customerReceivableEntries.createdAt))
        .limit(customerIds.length * 30),
    ]);

    const grossByCustomer = new Map(grossRows.map((row) => [row.customerId, row.grossSales]));
    const salesByCustomer = new Map<string, CustomerSalesHistoryRow[]>();
    const ledgerEventsByCustomer = new Map<string, Array<Omit<CustomerDebtLedgerRow, "balance"> & { sort: number }>>();

    function addSales(customerId: string | null, row: CustomerSalesHistoryRow) {
      if (!customerId) return;
      const current = salesByCustomer.get(customerId) ?? [];
      current.push(row);
      salesByCustomer.set(customerId, current);
    }

    function addLedger(customerId: string | null, row: Omit<CustomerDebtLedgerRow, "balance"> & { sort: number }) {
      if (!customerId) return;
      const current = ledgerEventsByCustomer.get(customerId) ?? [];
      current.push(row);
      ledgerEventsByCustomer.set(customerId, current);
    }

    for (const order of orderRows) {
      addSales(order.customerId, {
        id: order.id,
        kind: "order",
        code: order.code,
        orderId: order.id,
        createdAt: order.createdAt,
        sellerName: order.sellerName,
        total: order.total,
        status: order.status,
        itemCount: Number(order.itemCount),
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        productNames: order.productNames,
      });
      addLedger(order.customerId, {
        id: order.id,
        kind: "sale",
        code: order.code,
        orderId: order.id,
        createdAt: order.createdAt,
        typeLabel: "Bán hàng",
        value: Number(order.total),
        reason: null,
        sort: 10,
      });
    }

    for (const ret of returnRows) {
      addSales(ret.customerId, {
        id: ret.id,
        kind: "return",
        code: ret.code,
        orderId: ret.orderId,
        createdAt: ret.createdAt,
        sellerName: ret.sellerName,
        total: String(-Number(ret.totalRefund)),
        status: "returned",
        itemCount: Number(ret.itemCount),
        paymentStatus: "refunded",
        paymentMethod: ret.refundMethod ?? '',
        productNames: ret.productNames,
      });
      if (ret.refundMethod === "debt_deduct") {
        addLedger(ret.customerId, {
          id: ret.id,
          kind: "return",
          code: ret.code,
          orderId: ret.orderId,
          createdAt: ret.createdAt,
          typeLabel: "Trả hàng",
          value: -Number(ret.totalRefund),
          reason: null,
          sort: 30,
        });
      }
    }

    for (const payment of paymentRows) {
      addLedger(payment.customerId, {
        id: payment.id,
        kind: "payment",
        code: `TT-${payment.orderCode}`,
        orderId: payment.orderId,
        createdAt: payment.createdAt,
        typeLabel: "Thanh toán",
        value: -Number(payment.amount),
        reason: payment.note || payment.reference || payment.method,
        sort: 20,
      });
    }

    for (const entry of receivableEntryRows) {
      const isDiscount = entry.type === "settlement_discount";
      addLedger(entry.customerId, {
        id: entry.id,
        kind: isDiscount ? "discount" : "adjustment",
        code: entry.code,
        orderId: entry.orderId,
        createdAt: entry.createdAt,
        typeLabel: isDiscount ? "Chiết khấu thanh toán" : "Điều chỉnh công nợ",
        value: Number(entry.amount),
        reason: entry.reason,
        sort: 40,
      });
    }

    const ledgerByCustomer = new Map<string, CustomerDebtLedgerRow[]>();
    const currentDebtByCustomer = new Map(baseRows.map((row) => [row.id, Number(row.currentDebt)]));
    for (const [customerId, events] of ledgerEventsByCustomer.entries()) {
      events.sort((a, b) => {
        const byDate = b.createdAt.getTime() - a.createdAt.getTime();
        return byDate || b.sort - a.sort;
      });
      // The query is deliberately capped, so anchor the newest visible event to
      // the authoritative customer balance and walk backwards through history.
      let balance = currentDebtByCustomer.get(customerId) ?? 0;
      const ledger = events.map((event) => {
        const row = {
          id: event.id,
          kind: event.kind,
          code: event.code,
          orderId: event.orderId,
          createdAt: event.createdAt,
          typeLabel: event.typeLabel,
          value: event.value,
          reason: event.reason,
          balance,
        };
        balance -= event.value;
        return row;
      });
      ledgerByCustomer.set(customerId, ledger.slice(0, 50));
    }

    rows = baseRows.map((row) => ({
      ...row,
      grossSales: grossByCustomer.get(row.id) ?? "0",
      salesHistory: (salesByCustomer.get(row.id) ?? [])
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 30),
      debtLedger: ledgerByCustomer.get(row.id) ?? [],
    }));
  }

  return {
    ...summary,
    rows,
  };
}

export async function getCustomerPartnerDetail(storeId: string, id: string) {
  const result = await getCustomers(
    storeId,
    { customerId: id, page: 1, pageSize: 1 },
    { includeHistory: true },
  );
  return result.rows[0] ?? null;
}

export async function getCustomer(storeId: string, id: string) {
  const [customer] = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      zaloUserId: customers.zaloUserId,
      email: customers.email,
      address: customers.address,
      type: customers.type,
      taxCode: customers.taxCode,
      debtLimit: customers.debtLimit,
      currentDebt: customers.currentDebt,
      totalSpent: customers.totalSpent,
      portalToken: customers.portalToken,
      note: customers.note,
      isActive: customers.isActive,
      createdAt: customers.createdAt,
      consentStatus: customerConsents.status,
      consentPurposes: customerConsents.purposes,
      consentUpdatedAt: customerConsents.updatedAt,
    })
    .from(customers)
    .leftJoin(customerConsents, eq(customerConsents.customerId, customers.id))
    .where(and(eq(customers.id, id), eq(customers.storeId, storeId)))
    .limit(1);
  if (!customer) return null;

  const customerOrders = await db
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      projectName: orders.projectName,
      total: orders.total,
      amountPaid: orders.amountPaid,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(eq(orders.customerId, id), eq(orders.storeId, storeId)))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return { ...customer, orders: customerOrders };
}

export type CustomerListResult = Awaited<ReturnType<typeof getCustomers>>;

export async function getSupplier(storeId: string, id: string) {
  const [supplier] = await db.select().from(suppliers).where(and(
    eq(suppliers.id, id),
    eq(suppliers.storeId, storeId),
  )).limit(1);
  if (!supplier) return null;
  return supplier;
}

export async function getSupplierPurchases(storeId: string, id: string) {
  const { purchaseOrders, purchaseOrderItems } = await import("@/db/schema");
  return db
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      amountPaid: purchaseOrders.amountPaid,
      warehouseId: purchaseOrders.warehouseId,
      warehouseName: warehouses.name,
      createdAt: purchaseOrders.createdAt,
      itemCount: sql<number>`(select count(*)::int from ${purchaseOrderItems} where ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
    .where(and(
      eq(purchaseOrders.supplierId, id),
      eq(purchaseOrders.storeId, storeId),
    ))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(50);
}

export async function getSupplierPurchaseReturns(storeId: string, id: string) {
  const { purchaseReturnItems, purchaseReturns } = await import("@/db/schema");
  return db
    .select({
      id: purchaseReturns.id,
      code: purchaseReturns.code,
      status: purchaseReturns.status,
      settlementStatus: purchaseReturns.settlementStatus,
      totalRefund: purchaseReturns.totalRefund,
      refundAmount: purchaseReturns.refundAmount,
      debtAmount: purchaseReturns.debtAmount,
      warehouseId: purchaseReturns.warehouseId,
      warehouseName: warehouses.name,
      createdAt: purchaseReturns.createdAt,
      itemCount: sql<number>`(select count(*)::int from ${purchaseReturnItems} where ${purchaseReturnItems.purchaseReturnId} = ${purchaseReturns.id})`,
    })
    .from(purchaseReturns)
    .innerJoin(warehouses, eq(purchaseReturns.warehouseId, warehouses.id))
    .where(and(
      eq(purchaseReturns.supplierId, id),
      eq(purchaseReturns.storeId, storeId),
    ))
    .orderBy(desc(purchaseReturns.createdAt))
    .limit(50);
}

export async function getSupplierPreview(storeId: string, id: string) {
  const [supplier, purchases, purchaseReturns, payables] = await Promise.all([
    getSupplier(storeId, id),
    getSupplierPurchases(storeId, id),
    getSupplierPurchaseReturns(storeId, id),
    getSupplierPayableOverview(storeId, id),
  ]);
  if (!supplier) return null;
  return { supplier, purchases, purchaseReturns, payables };
}

export type SupplierDetail = NonNullable<Awaited<ReturnType<typeof getSupplier>>>;

export async function getSuppliers(storeId: string, filters: { q?: string; owing?: "owing" | "clear"; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions: SQL[] = [eq(suppliers.storeId, storeId)];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(suppliers.name, q), accentInsensitiveLike(suppliers.phone, q), accentInsensitiveLike(suppliers.code, q));
    if (c) conditions.push(c);
  }
  if (filters.owing === "owing") conditions.push(sql`${suppliers.currentDebt} > 0`);
  else if (filters.owing === "clear") conditions.push(sql`${suppliers.currentDebt} <= 0`);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(suppliers).where(where)
      .orderBy(desc(suppliers.currentDebt), desc(suppliers.createdAt))
      .limit(size).offset((page - 1) * size),
    db.select({ total: count() }).from(suppliers).where(where),
  ]);

  return { rows, total, page, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)) };
}

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

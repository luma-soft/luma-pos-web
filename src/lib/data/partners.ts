import { and, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  customerConsents,
  customers,
  orders,
  payments,
  profiles,
  returns,
  suppliers,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";

export const PARTNERS_PAGE_SIZE = 20;

const CUSTOMER_TYPES = ["retail", "wholesale", "contractor", "agent"] as const;
type CustomerType = (typeof CUSTOMER_TYPES)[number];

export type CustomerFilters = {
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
};

export type CustomerDebtLedgerRow = {
  id: string;
  kind: "sale" | "payment" | "return";
  code: string;
  orderId: string | null;
  createdAt: Date;
  typeLabel: string;
  value: number;
  balance: number;
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

function buildCustomerConditions(filters: CustomerFilters) {
  const conditions: SQL[] = [eq(customers.isActive, true)];

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
        and ${orders.status} in ('completed', 'returned')
    )`;
    if (lastTxFrom) conditions.push(sql`${lastTx} >= ${lastTxFrom}`);
    if (lastTxTo) conditions.push(sql`${lastTx} <= ${lastTxTo}`);
  }

  return conditions;
}

const saleOrderStatus = sql`${orders.status} in ('completed', 'returned')`;

export async function getCustomers(filters: CustomerFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions = buildCustomerConditions(filters);
  const where = and(...conditions);

  const [baseRows, [{ total }], [moneyAgg], [grossAgg]] = await Promise.all([
    db
      .select({
        id: customers.id,
        code: customers.code,
        name: customers.name,
        phone: customers.phone,
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
            and ${orders.status} in ('completed', 'returned')
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
      })
      .from(customers)
      .where(where),
    db
      .select({
        totalGrossSales: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(where, saleOrderStatus)),
  ]);

  const customerIds = baseRows.map((row) => row.id);
  let rows = baseRows.map((row) => ({
    ...row,
    grossSales: "0",
    salesHistory: [] as CustomerSalesHistoryRow[],
    debtLedger: [] as CustomerDebtLedgerRow[],
  }));

  if (customerIds.length > 0) {
    const [grossRows, orderRows, returnRows, paymentRows] = await Promise.all([
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
          createdAt: orders.createdAt,
          sellerName: profiles.fullName,
        })
        .from(orders)
        .leftJoin(profiles, eq(orders.createdBy, profiles.id))
        .where(and(inArray(orders.customerId, customerIds), saleOrderStatus))
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
          createdAt: returns.createdAt,
          sellerName: profiles.fullName,
        })
        .from(returns)
        .leftJoin(profiles, eq(returns.createdBy, profiles.id))
        .where(inArray(returns.customerId, customerIds))
        .orderBy(desc(returns.createdAt))
        .limit(customerIds.length * 30),
      db
        .select({
          customerId: orders.customerId,
          id: payments.id,
          orderId: orders.id,
          orderCode: orders.code,
          amount: payments.amount,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(inArray(orders.customerId, customerIds))
        .orderBy(desc(payments.createdAt))
        .limit(customerIds.length * 60),
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
      });
      addLedger(order.customerId, {
        id: order.id,
        kind: "sale",
        code: order.code,
        orderId: order.id,
        createdAt: order.createdAt,
        typeLabel: "Bán hàng",
        value: Number(order.total),
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
        sort: 20,
      });
    }

    const ledgerByCustomer = new Map<string, CustomerDebtLedgerRow[]>();
    for (const [customerId, events] of ledgerEventsByCustomer.entries()) {
      events.sort((a, b) => {
        const byDate = a.createdAt.getTime() - b.createdAt.getTime();
        return byDate || a.sort - b.sort;
      });
      let balance = 0;
      const ledger = events.map((event) => {
        balance += event.value;
        return {
          id: event.id,
          kind: event.kind,
          code: event.code,
          orderId: event.orderId,
          createdAt: event.createdAt,
          typeLabel: event.typeLabel,
          value: event.value,
          balance,
        };
      });
      ledgerByCustomer.set(customerId, ledger.reverse().slice(0, 50));
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
    rows, total, page, pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
    totalDebt: Number(moneyAgg.totalDebt),
    totalGrossSales: Number(grossAgg.totalGrossSales),
    totalNetSales: Number(moneyAgg.totalNetSales),
  };
}

export async function getCustomer(id: string) {
  const [customer] = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
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
    .where(eq(customers.id, id))
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
    .where(eq(orders.customerId, id))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return { ...customer, orders: customerOrders };
}

export type CustomerListResult = Awaited<ReturnType<typeof getCustomers>>;

export async function getSupplier(id: string) {
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!supplier) return null;
  return supplier;
}

export async function getSupplierPurchases(id: string) {
  const { purchaseOrders, purchaseOrderItems } = await import("@/db/schema");
  return db
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      amountPaid: purchaseOrders.amountPaid,
      createdAt: purchaseOrders.createdAt,
      itemCount: sql<number>`(select count(*)::int from ${purchaseOrderItems} where ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.supplierId, id))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(50);
}
export type SupplierDetail = NonNullable<Awaited<ReturnType<typeof getSupplier>>>;

export async function getSuppliers(filters: { q?: string; owing?: "owing" | "clear"; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conditions: SQL[] = [];
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

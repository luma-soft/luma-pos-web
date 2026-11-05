"use server";

import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, stockLevels, stockMovements } from "@/db/schema";
import { requireRole } from "@/lib/actions/common";
import { STOCK_READ_ROLES } from "@/lib/auth/roles";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";

const PAGE_SIZE = 40;
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function stockHistoryVersion(storeId: string, productId: string): Promise<string> {
  // Two narrowly scoped indexed reads, independent of unrelated products'
  // global catalog revisions. The movement journal is append-only in normal
  // inventory operations; count detects removals and latest identifies inserts.
  const [[latest], [aggregate]] = await Promise.all([
    db.select({ id: stockMovements.id, createdAt: stockMovements.createdAt })
      .from(stockMovements)
      .where(and(eq(stockMovements.storeId, storeId), eq(stockMovements.productId, productId)))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(1),
    db.select({
      count: sql<string>`count(*)::text`,
      quantity: sql<string>`coalesce(sum(${stockMovements.quantity}), 0)::text`,
    }).from(stockMovements).where(and(
      eq(stockMovements.storeId, storeId), eq(stockMovements.productId, productId),
    )),
  ]);
  return [latest?.id ?? "-", latest?.createdAt?.toISOString() ?? "-",
    aggregate?.count ?? "0", aggregate?.quantity ?? "0"].join(":");
}

export async function checkProductStockHistoryVersion(productId: string) {
  const gate = await requireRole([...STOCK_READ_ROLES]);
  if (!gate.ok) return { ok: false as const, error: gate.error };
  if (!PRODUCT_ID.test(productId)) return { ok: false as const, error: "errors.invalidData" };
  const [authorized] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.storeId, gate.storeId), eq(products.id, productId))).limit(1);
  if (!authorized) return { ok: false as const, error: "errors.forbidden" };
  return {
    ok: true as const,
    data: {
      scopeId: `${gate.storeId}:${gate.userId}:${gate.role}`,
      version: await stockHistoryVersion(gate.storeId, productId),
    },
  };
}

/**
 * Fetch history only for the requested, authorized product. Do not project
 * transaction history into the shared offline product catalog.
 */
export async function loadProductStockHistory(productId: string, requestedPage = 1) {
  const gate = await requireRole([...STOCK_READ_ROLES]);
  if (!gate.ok) return { ok: false as const, error: gate.error };
  if (!PRODUCT_ID.test(productId)) {
    return { ok: false as const, error: "errors.invalidData" };
  }
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 10_000) : 1;
  const storeId = gate.storeId;
  const [authorizedProduct] = await db.select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.id, productId)))
    .limit(1);
  if (!authorizedProduct) return { ok: false as const, error: "errors.forbidden" };

  const pageRows = await db.select({
    id: stockMovements.id,
    productId: stockMovements.productId,
    type: stockMovements.type,
    quantity: stockMovements.quantity,
    unitCost: stockMovements.unitCost,
    refType: stockMovements.refType,
    refId: stockMovements.refId,
    note: stockMovements.note,
    createdAt: stockMovements.createdAt,
    documentCode: sql<string | null>`case
      when ${stockMovements.refType} = 'order' then (select o.code from orders o where o.id = ${stockMovements.refId} and o.store_id = ${storeId} limit 1)
      when ${stockMovements.refType} = 'purchase' then (select po.code from purchase_orders po where po.id = ${stockMovements.refId} and po.store_id = ${storeId} limit 1)
      when ${stockMovements.refType} = 'return' then (select r.code from returns r where r.id = ${stockMovements.refId} and r.store_id = ${storeId} limit 1)
      when ${stockMovements.refType} = 'stocktake' then (select st.code from stocktakes st where st.id = ${stockMovements.refId} and st.store_id = ${storeId} limit 1)
      when ${stockMovements.refType} = 'internal_use' then (select iu.code from internal_use_issues iu where iu.id = ${stockMovements.refId} and iu.store_id = ${storeId} limit 1)
      else ${stockMovements.note} end`,
    partnerId: sql<string | null>`case
      when ${stockMovements.refType} = 'order' then (select o.customer_id from orders o where o.id = ${stockMovements.refId} and o.store_id = ${storeId} limit 1)
      when ${stockMovements.refType} = 'purchase' then (select po.supplier_id from purchase_orders po where po.id = ${stockMovements.refId} and po.store_id = ${storeId} limit 1)
      else null end`,
    partnerName: sql<string | null>`case
      when ${stockMovements.refType} = 'order' then coalesce((
        select c.name from orders o left join customers c on c.id = o.customer_id
        where o.id = ${stockMovements.refId} and o.store_id = ${storeId} limit 1
      ), 'Khách lẻ')
      when ${stockMovements.refType} = 'purchase' then (
        select s.name from purchase_orders po left join suppliers s on s.id = po.supplier_id
        where po.id = ${stockMovements.refId} and po.store_id = ${storeId} limit 1
      ) else null end`,
    transactionPrice: sql<string | null>`case
      when ${stockMovements.refType} = 'order' then (
        select oi.unit_price from order_items oi where oi.order_id = ${stockMovements.refId} and oi.product_id = ${stockMovements.productId} limit 1
      )
      when ${stockMovements.refType} = 'purchase' then (
        select poi.unit_cost from purchase_order_items poi where poi.purchase_order_id = ${stockMovements.refId} and poi.product_id = ${stockMovements.productId} limit 1
      ) else null end`,
  }).from(stockMovements)
    .where(and(eq(stockMovements.storeId, storeId), eq(stockMovements.productId, productId)))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  const hasMore = pageRows.length > PAGE_SIZE;
  const movements = pageRows.slice(0, PAGE_SIZE);
  const [stock] = await db.select({
    quantity: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)`,
  }).from(stockLevels).where(and(
    eq(stockLevels.storeId, storeId), eq(stockLevels.productId, productId),
  ));

  let newerMovements = 0;
  if (movements.length > 0) {
    const first = movements[0];
    const [newer] = await db.select({
      quantity: sql<string>`coalesce(sum(${stockMovements.quantity}), 0)`,
    }).from(stockMovements).where(and(
      eq(stockMovements.storeId, storeId),
      eq(stockMovements.productId, productId),
      or(
        gt(stockMovements.createdAt, first.createdAt),
        and(eq(stockMovements.createdAt, first.createdAt), gt(stockMovements.id, first.id)),
      ),
    ));
    newerMovements = Number(newer?.quantity ?? 0);
  }

  const canSeeCosts = canViewPurchasePrices(gate.role);
  let balance = Number(stock?.quantity ?? 0) - newerMovements;
  const rows = movements.map((movement) => {
    const stockAfter = String(balance);
    balance -= Number(movement.quantity);
    return {
      ...movement,
      stockAfter,
      unitCost: canSeeCosts ? movement.unitCost : null,
      transactionPrice: canSeeCosts || movement.refType !== "purchase" ? movement.transactionPrice : null,
    };
  });
  return { ok: true as const, data: {
    rows, page, hasMore,
    scopeId: `${gate.storeId}:${gate.userId}:${gate.role}`,
    version: await stockHistoryVersion(storeId, productId),
  } };
}

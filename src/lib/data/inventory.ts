import { and, asc, count, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  internalUseIssues, products, profiles, purchaseOrderItems, purchaseOrders, stockMovements, suppliers, warehouses,
} from "@/db/schema";
import { unstable_cache } from "next/cache";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";

export const INVENTORY_PAGE_SIZE = 30;

export type StockFilter = "all" | "instock" | "low" | "out";

/**
 * Thống kê tồn kho toàn cục (tổng giá trị tồn + số SP sắp hết) — đọc thẳng cột
 * denormalize products.total_stock/min_stock, 1 câu aggregate (không join/groupBy).
 * Cache 60s vì không phụ thuộc bộ lọc/trang.
 */
const getInventoryStats = unstable_cache(
  async () => {
    const [agg] = await db
      .select({
        totalValue: sql<string>`coalesce(sum(${products.totalStock} * ${products.costPrice}), 0)`,
        lowCount: sql<number>`count(*) filter (where ${products.totalStock} <= ${products.minStock} and ${products.minStock} > 0)`,
      })
      .from(products)
      .where(eq(products.isActive, true));
    return { totalValue: Number(agg.totalValue), lowCount: Number(agg.lowCount) };
  },
  ["inventory-stats"],
  { revalidate: 60 }
);

export async function getInventory(filters: { q?: string; low?: boolean; stock?: StockFilter; categoryId?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize, INVENTORY_PAGE_SIZE);
  const hasComplianceColumns = await hasProductComplianceColumns();
  const conditions: SQL[] = [eq(products.isActive, true)];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(products.name, q), accentInsensitiveLike(products.sku, q));
    if (c) conditions.push(c);
  }
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));

  // Tình trạng tồn → điều kiện WHERE trên cột denormalize (KHÔNG cần GROUP BY/HAVING).
  const stock: StockFilter = filters.low ? "low" : (filters.stock ?? "all");
  if (stock === "instock") conditions.push(sql`${products.totalStock} > 0`);
  else if (stock === "out") conditions.push(sql`${products.totalStock} <= 0`);
  else if (stock === "low") conditions.push(sql`${products.totalStock} <= ${products.minStock} and ${products.minStock} > 0`);
  const where = and(...conditions);

  const [rows, [{ n: total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        trackBatches: hasComplianceColumns ? products.trackBatches : sql<boolean>`false`,
        shelfLifeDays: hasComplianceColumns ? products.shelfLifeDays : sql<number | null>`null`,
        totalStock: products.totalStock,
        minLevel: products.minStock,
        stockValue: sql<string>`${products.totalStock} * ${products.costPrice}`,
        units: sql<{ unitName: string; multiplier: string; barcode: string | null }[]>`coalesce((
          select json_agg(json_build_object('unitName', pu.unit_name, 'multiplier', pu.multiplier, 'barcode', pu.barcode) order by pu.sort_order)
          from product_units pu where pu.product_id = ${products.id}
        ), '[]')`,
      })
      .from(products)
      .where(where)
      .orderBy(asc(products.name))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(products).where(where),
  ]);

  const { totalValue, lowCount } = await getInventoryStats();

  return {
    rows, total, page, pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
    totalValue,
    lowCount,
  };
}

// Lịch sử xuất nhập gần đây — cache 30s, không phải truy vấn lại mỗi lần mở Tồn kho.
export const getRecentMovements = unstable_cache(
  async (limit = 30) => db
    .select({
      id: stockMovements.id,
      productId: stockMovements.productId,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      productName: products.name,
      baseUnit: products.baseUnit,
      warehouseName: warehouses.name,
      byName: profiles.fullName,
    })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    .innerJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stockMovements.createdBy, profiles.id))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit),
  ["recent-movements"],
  { revalidate: 30 }
);

export async function getInternalUseCostSummary() {
  const periodStart = new Date();
  periodStart.setHours(0, 0, 0, 0);
  periodStart.setDate(1);
  const [summary] = await db
    .select({
      total: sql<string>`coalesce(sum(${internalUseIssues.totalCost}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(internalUseIssues)
    .where(gte(internalUseIssues.createdAt, periodStart));
  return {
    total: Number(summary.total),
    count: summary.count,
    periodStart: periodStart.toISOString(),
  };
}

export async function getPurchases(filters: { q?: string; status?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conds: SQL[] = [];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(purchaseOrders.code, q), accentInsensitiveLike(suppliers.name, q));
    if (c) conds.push(c);
  }
  if (filters.status && ["received", "returned", "cancelled", "draft"].includes(filters.status)) {
    conds.push(eq(purchaseOrders.status, filters.status));
  }
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        supplierId: purchaseOrders.supplierId,
        warehouseId: purchaseOrders.warehouseId,
        status: purchaseOrders.status,
        subtotal: purchaseOrders.subtotal,
        discount: purchaseOrders.discount,
        vatRate: purchaseOrders.vatRate,
        tax: purchaseOrders.tax,
        total: purchaseOrders.total,
        amountPaid: purchaseOrders.amountPaid,
        invoiceNumber: purchaseOrders.invoiceNumber,
        note: purchaseOrders.note,
        createdAt: purchaseOrders.createdAt,
        supplierName: suppliers.name,
        supplierPhone: suppliers.phone,
        warehouseName: warehouses.name,
        createdByName: profiles.fullName,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .innerJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
      .leftJoin(profiles, eq(purchaseOrders.createdBy, profiles.id))
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(where),
  ]);
  const ids = rows.map((row) => row.id);
  const itemRows = ids.length
    ? await db
        .select({
          id: purchaseOrderItems.id,
          purchaseOrderId: purchaseOrderItems.purchaseOrderId,
          productId: purchaseOrderItems.productId,
          quantity: purchaseOrderItems.quantity,
          unitCost: purchaseOrderItems.unitCost,
          discount: purchaseOrderItems.discount,
          total: purchaseOrderItems.total,
          productName: products.name,
          sku: products.sku,
          baseUnit: products.baseUnit,
        })
        .from(purchaseOrderItems)
        .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
        .where(inArray(purchaseOrderItems.purchaseOrderId, ids))
        .orderBy(asc(products.name))
    : [];
  const itemsByPurchase = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const current = itemsByPurchase.get(item.purchaseOrderId) ?? [];
    current.push(item);
    itemsByPurchase.set(item.purchaseOrderId, current);
  }
  return {
    rows: rows.map((row) => ({ ...row, items: itemsByPurchase.get(row.id) ?? [] })),
    total,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
}

/** Chi tiết phiếu nhập (cho trang in). */
export async function getPurchase(id: string) {
  const [po] = await db
    .select({
      id: purchaseOrders.id,
      code: purchaseOrders.code,
      supplierId: purchaseOrders.supplierId,
      warehouseId: purchaseOrders.warehouseId,
      status: purchaseOrders.status,
      subtotal: purchaseOrders.subtotal,
      discount: purchaseOrders.discount,
      vatRate: purchaseOrders.vatRate,
      tax: purchaseOrders.tax,
      total: purchaseOrders.total,
      amountPaid: purchaseOrders.amountPaid,
      invoiceNumber: purchaseOrders.invoiceNumber,
      note: purchaseOrders.note,
      createdAt: purchaseOrders.createdAt,
      supplierName: suppliers.name,
      supplierPhone: suppliers.phone,
      warehouseName: warehouses.name,
      createdByName: profiles.fullName,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .innerJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(purchaseOrders.createdBy, profiles.id))
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!po) return null;

  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      quantity: purchaseOrderItems.quantity,
      unitCost: purchaseOrderItems.unitCost,
      discount: purchaseOrderItems.discount,
      total: purchaseOrderItems.total,
      productName: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, id));

  return { ...po, items };
}

/** Options cho form tạo phiếu nhập. */
export async function getPurchaseFormOptions() {
  const [supplierRows, warehouseRows] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault }).from(warehouses).orderBy(desc(warehouses.isDefault)),
  ]);
  return { suppliers: supplierRows, warehouses: warehouseRows };
}

export type PurchaseFormOptions = Awaited<ReturnType<typeof getPurchaseFormOptions>>;

/** Tìm SP cho phiếu nhập — query thẳng DB, bỏ dấu, quét toàn bộ (giống POS). */
const purchaseProductSelection = {
  id: products.id,
  name: products.name,
  sku: products.sku,
  baseUnit: products.baseUnit,
  costPrice: products.costPrice,
  totalStock: products.totalStock,
  units: sql<{ unitName: string; multiplier: string }[]>`coalesce((
    select json_agg(json_build_object('unitName', pu.unit_name, 'multiplier', pu.multiplier) order by pu.sort_order)
    from product_units pu where pu.product_id = ${products.id}
  ), '[]')`,
};

export async function getPurchaseProductRowsByIds(ids: string[]) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return [];
  return db
    .select(purchaseProductSelection)
    .from(products)
    .where(and(eq(products.isActive, true), inArray(products.id, uniqueIds)))
    .orderBy(asc(products.name));
}

export async function searchPurchaseProductRows(q: string) {
  if (!q.trim()) return [];
  const term = q.trim();
  return db
    .select(purchaseProductSelection)
    .from(products)
    .where(and(
      eq(products.isActive, true),
      or(accentInsensitiveLike(products.name, term), accentInsensitiveLike(products.sku, term), accentInsensitiveLike(products.barcode, term)),
    ))
    .orderBy(asc(products.name))
    .limit(30);
}
export type PurchaseProductRow = Awaited<ReturnType<typeof searchPurchaseProductRows>>[number];

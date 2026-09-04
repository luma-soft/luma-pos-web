import { and, asc, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  categories, internalUseIssues, products, profiles, purchaseOrderItems, purchaseOrders, stockLevels, stockMovements, suppliers, warehouses,
} from "@/db/schema";
import { unstable_cache } from "next/cache";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize } from "@/lib/pagination";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";
import { stockManagedCategoryCondition } from "@/lib/data/product-stock";
import {
  pricingStockCondition,
  type PricingStockFilter,
} from "@/lib/data/pricing-stock";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";

export const INVENTORY_PAGE_SIZE = 30;

export type StockFilter =
  | "all"
  | "instock"
  | "low"
  | "out"
  | PricingStockFilter;

export type InventoryStatusCounts = Record<
  Exclude<PricingStockFilter, "available">,
  number
>;

/**
 * Thống kê tồn kho toàn cục (tổng giá trị tồn + số SP sắp hết) — đọc thẳng cột
 * denormalize products.total_stock/min_stock, 1 câu aggregate (không join/groupBy).
 * Cache 60s vì không phụ thuộc bộ lọc/trang.
 */
const getInventoryStats = unstable_cache(
  async (storeId: string) => {
    const [agg] = await db
      .select({
        totalValue: sql<string>`coalesce(sum(${products.totalStock} * ${products.costPrice}), 0)`,
        totalSkuCount: sql<number>`count(*)::int`,
        negativeStock: sql<number>`count(*) filter (where ${products.totalStock} < 0)::int`,
        outOfStock: sql<number>`count(*) filter (where ${products.totalStock} = 0)::int`,
        lowStock: sql<number>`count(*) filter (where ${products.totalStock} > 0 and ${products.totalStock} < ${products.minStock})::int`,
        inStock: sql<number>`count(*) filter (where ${products.totalStock} > 0 and ${products.totalStock} >= ${products.minStock})::int`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        eq(products.storeId, storeId),
        eq(products.isActive, true),
        stockManagedCategoryCondition(),
      ));
    return {
      totalValue: Number(agg.totalValue),
      totalSkuCount: Number(agg.totalSkuCount),
      statusCounts: {
        negativeStock: Number(agg.negativeStock),
        outOfStock: Number(agg.outOfStock),
        lowStock: Number(agg.lowStock),
        inStock: Number(agg.inStock),
      } satisfies InventoryStatusCounts,
    };
  },
  ["inventory-stats"],
  { revalidate: 60 }
);

export async function getInventory(storeId: string, filters: { q?: string; low?: boolean; stock?: StockFilter; categoryId?: string; warehouseId?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize, INVENTORY_PAGE_SIZE);
  const hasComplianceColumns = await hasProductComplianceColumns();
  const conditions: SQL[] = [
    eq(products.storeId, storeId),
    eq(products.isActive, true),
    stockManagedCategoryCondition(),
  ];
  const availableStock = filters.warehouseId?.trim()
    ? sql<string>`coalesce((
        select sl.quantity
        from ${stockLevels} sl
        where sl.product_id = ${products.id}
          and sl.store_id = ${storeId}
          and sl.warehouse_id = ${filters.warehouseId.trim()}
        limit 1
      ), 0)`
    : products.totalStock;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(products.name, q), accentInsensitiveLike(products.sku, q));
    if (c) conditions.push(c);
  }
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));

  // Tình trạng tồn → điều kiện WHERE trên cột denormalize (KHÔNG cần GROUP BY/HAVING).
  const stock: StockFilter = filters.low ? "low" : (filters.stock ?? "all");
  const statusCondition = pricingStockCondition(
    stock,
    availableStock,
    products.minStock,
  );
  if (statusCondition) conditions.push(statusCondition);
  else if (stock === "instock") conditions.push(sql`${availableStock} > 0`);
  else if (stock === "out") conditions.push(sql`${availableStock} <= 0`);
  else if (stock === "low") conditions.push(sql`${availableStock} <= ${products.minStock} and ${products.minStock} > 0`);
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
        totalStock: availableStock,
        minLevel: products.minStock,
        stockValue: sql<string>`${availableStock} * ${products.costPrice}`,
        units: sql<{ unitName: string; multiplier: string; barcode: string | null }[]>`coalesce((
          select json_agg(json_build_object('unitName', pu.unit_name, 'multiplier', pu.multiplier, 'barcode', pu.barcode) order by pu.sort_order)
          from product_units pu where pu.product_id = ${products.id}
        ), '[]')`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .orderBy(asc(products.name))
      .limit(size)
      .offset((page - 1) * size),
    db
      .select({ n: count() })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where),
  ]);

  const stats = await getInventoryStats(storeId);

  return {
    rows, total, page, pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
    totalValue: stats.totalValue,
    lowCount: stats.statusCounts.lowStock,
  };
}

export async function getInventoryOverview(storeId: string) {
  return getInventoryStats(storeId);
}

// Lịch sử xuất nhập gần đây — cache 30s, không phải truy vấn lại mỗi lần mở Tồn kho.
export const getRecentMovements = unstable_cache(
  async (storeId: string, limit = 30) => db
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
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stockMovements.createdBy, profiles.id))
    .where(and(
      eq(stockMovements.storeId, storeId),
      stockManagedCategoryCondition(),
    ))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit),
  ["recent-movements"],
  { revalidate: 30 }
);

export async function getInternalUseCostSummary(storeId: string) {
  const periodStart = new Date();
  periodStart.setHours(0, 0, 0, 0);
  periodStart.setDate(1);
  const [summary] = await db
    .select({
      total: sql<string>`coalesce(sum(${internalUseIssues.totalCost}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(internalUseIssues)
    .where(and(
      eq(internalUseIssues.storeId, storeId),
      gte(internalUseIssues.createdAt, periodStart),
    ));
  return {
    total: Number(summary.total),
    count: summary.count,
    periodStart: periodStart.toISOString(),
  };
}

export async function getPurchases(storeId: string, filters: { q?: string; status?: string; supplierId?: string; warehouseId?: string; from?: string; to?: string; debtOnly?: boolean; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize);
  const conds: SQL[] = [eq(purchaseOrders.storeId, storeId)];
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const c = or(accentInsensitiveLike(purchaseOrders.code, q), accentInsensitiveLike(suppliers.name, q));
    if (c) conds.push(c);
  }
  if (filters.status && ["received", "returned", "cancelled", "draft"].includes(filters.status)) {
    conds.push(eq(purchaseOrders.status, filters.status));
  }
  if (filters.supplierId) conds.push(eq(purchaseOrders.supplierId, filters.supplierId));
  if (filters.warehouseId) conds.push(eq(purchaseOrders.warehouseId, filters.warehouseId));
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) conds.push(gte(purchaseOrders.createdAt, new Date(`${filters.from}T00:00:00`)));
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) conds.push(lte(purchaseOrders.createdAt, new Date(`${filters.to}T23:59:59.999`)));
  if (filters.debtOnly) conds.push(sql`${purchaseOrders.total} > ${purchaseOrders.amountPaid}`);
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
        shippingFee: purchaseOrders.shippingFee,
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
        .where(and(
          eq(purchaseOrderItems.storeId, storeId),
          inArray(purchaseOrderItems.purchaseOrderId, ids),
        ))
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
export async function getPurchase(storeId: string, id: string) {
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
      shippingFee: purchaseOrders.shippingFee,
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
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.storeId, storeId)))
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
      imageUrls: productCompatibilityImageUrls(storeId),
      imageUpdatedAt: products.imageUpdatedAt,
      batchNumber: purchaseOrderItems.batchNumber,
      expiryDate: purchaseOrderItems.expiryDate,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(and(
      eq(purchaseOrderItems.purchaseOrderId, id),
      eq(purchaseOrderItems.storeId, storeId),
    ));

  return { ...po, items };
}

/** Options cho form tạo phiếu nhập. */
export async function getPurchaseFormOptions(storeId: string) {
  const [supplierRows, warehouseRows] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.storeId, storeId)).orderBy(asc(suppliers.name)),
    db.select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault }).from(warehouses).where(eq(warehouses.storeId, storeId)).orderBy(desc(warehouses.isDefault)),
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

export async function getPurchaseProductRowsByIds(
  storeId: string,
  ids: string[],
  { includeInactive = false }: { includeInactive?: boolean } = {},
) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return [];
  return db
    .select(purchaseProductSelection)
    .from(products)
    .where(
      includeInactive
        ? and(eq(products.storeId, storeId), inArray(products.id, uniqueIds))
        : and(
          eq(products.storeId, storeId),
          eq(products.isActive, true),
          inArray(products.id, uniqueIds),
        ),
    )
    .orderBy(asc(products.name));
}

export async function searchPurchaseProductRows(storeId: string, q: string) {
  if (!q.trim()) return [];
  const term = q.trim();
  return db
    .select(purchaseProductSelection)
    .from(products)
    .where(and(
      eq(products.storeId, storeId),
      eq(products.isActive, true),
      or(accentInsensitiveLike(products.name, term), accentInsensitiveLike(products.sku, term), accentInsensitiveLike(products.barcode, term)),
    ))
    .orderBy(asc(products.name))
    .limit(30);
}
export type PurchaseProductRow = Awaited<ReturnType<typeof searchPurchaseProductRows>>[number];

import { and, asc, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, profiles, stockLevels, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { stocktakeListSummaryFields } from "@/lib/stocktakes/list-summary-fields";

type SP = Record<string, string | undefined>;

/** Stocktake list query shared by the server page and the phone load-more action. */
export async function getStocktakeListPage(
  context: { storeId: string; role: Parameters<typeof canViewPurchasePrices>[0] },
  searchParams: SP,
  requestedPage: number,
  pageSize: number,
) {
  const q = searchParams.stocktakeQ?.trim();
  const searchCondition = q
    ? or(
      ilike(stocktakes.code, `%${q}%`),
      ilike(stocktakes.note, `%${q}%`),
      ilike(warehouses.name, `%${q}%`),
      ilike(profiles.fullName, `%${q}%`),
    )
    : undefined;
  const where = and(
    eq(stocktakes.storeId, context.storeId),
    ne(stocktakes.status, "cancelled"),
    searchCondition,
  );
  const canViewValues = canViewPurchasePrices(context.role);

  const [countResult] = await db
    .select({ total: count() })
    .from(stocktakes)
    .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
    .where(where);
  const total = countResult?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  const rows = await db
    .select({
      id: stocktakes.id, code: stocktakes.code, status: stocktakes.status, note: stocktakes.note,
      createdAt: stocktakes.createdAt, balancedAt: stocktakes.balancedAt, warehouseName: warehouses.name, byName: profiles.fullName,
      itemCount: sql<number>`(select count(*) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id})::int`,
      totalDiff: sql<string>`coalesce((select sum(${stocktakeItems.actualQty} - ${stocktakeItems.systemQty}) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id}), 0)`,
      ...stocktakeListSummaryFields(context.storeId, canViewValues),
    })
    .from(stocktakes)
    .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
    .where(where)
    .orderBy(desc(stocktakes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total, page, pageCount, canViewValues };
}

/** One stocktake of the store with its lines, for the print page. */
export async function getStocktakePrintData(storeId: string, stocktakeId: string, canViewValues: boolean) {
  const [stocktake] = await db
    .select({
      id: stocktakes.id,
      code: stocktakes.code,
      status: stocktakes.status,
      note: stocktakes.note,
      createdAt: stocktakes.createdAt,
      balancedAt: stocktakes.balancedAt,
      warehouseName: warehouses.name,
      byName: profiles.fullName,
    })
    .from(stocktakes)
    .innerJoin(warehouses, and(
      eq(stocktakes.warehouseId, warehouses.id),
      eq(warehouses.storeId, storeId),
    ))
    .leftJoin(profiles, and(
      eq(stocktakes.createdBy, profiles.id),
      eq(profiles.storeId, storeId),
    ))
    .where(and(eq(stocktakes.storeId, storeId), eq(stocktakes.id, stocktakeId)))
    .limit(1);
  if (!stocktake) return null;
  const items = await db
    .select({
      id: stocktakeItems.id,
      productName: sql<string>`case when ${products.lifecycleStatus} = 'deleted' then ${products.name} || ' {DEL}' else ${products.name} end`,
      sku: products.sku,
      baseUnit: products.baseUnit,
      systemQty: stocktakeItems.systemQty,
      actualQty: stocktakeItems.actualQty,
      costPrice: canViewValues ? products.costPrice : sql<string | null>`null`,
    })
    .from(stocktakeItems)
    .innerJoin(products, and(
      eq(stocktakeItems.productId, products.id),
      eq(products.storeId, storeId),
    ))
    .where(and(
      eq(stocktakeItems.storeId, storeId),
      eq(stocktakeItems.stocktakeId, stocktakeId),
    ))
    .orderBy(asc(products.name), asc(products.sku));
  return { stocktake, items };
}

/**
 * Warehouses for a new stocktake and, when copying (`copyId`), the source
 * stocktake with its lines. Null when the stocktake to copy is not in the store.
 */
export async function getNewStocktakeData(storeId: string, copyId?: string) {
  const warehouseRows = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.storeId, storeId))
    .orderBy(desc(warehouses.isDefault));

  const [source] = copyId
    ? await db.select({
      id: stocktakes.id,
      code: stocktakes.code,
      note: stocktakes.note,
      warehouseId: stocktakes.warehouseId,
    })
      .from(stocktakes)
      .where(and(eq(stocktakes.storeId, storeId), eq(stocktakes.id, copyId)))
      .limit(1)
    : [];
  if (copyId && !source) return null;

  const copiedRows = source
    ? await db.select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      baseUnit: products.baseUnit,
      costPrice: products.costPrice,
      currentStock: sql<string>`coalesce(${stockLevels.quantity}, 0)`,
      actualQty: stocktakeItems.actualQty,
    })
      .from(stocktakeItems)
      .innerJoin(products, and(
        eq(stocktakeItems.productId, products.id),
        eq(products.storeId, storeId),
      ))
      .leftJoin(stockLevels, and(
        eq(stockLevels.storeId, storeId),
        eq(stockLevels.productId, products.id),
        eq(stockLevels.warehouseId, source.warehouseId),
      ))
      .where(and(eq(stocktakeItems.storeId, storeId), eq(stocktakeItems.stocktakeId, source.id)))
    : [];
  return { warehouseRows, source, copiedRows };
}

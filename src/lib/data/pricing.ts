import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  categories,
  productPrices,
  priceBooks,
  productUnits,
  products,
  stockLevels,
  suppliers,
} from "@/db/schema";
import { coercePageSize } from "@/lib/pagination";
import { accentInsensitiveLike } from "@/lib/search";
import {
  pricingProjectionPolicy,
  pricingSortSpec,
  type PricingSort,
} from "@/lib/pricing/pricing-policy";
import { pricingStockCondition } from "@/lib/data/pricing-stock";
import { lastPurchaseNetPriceSql } from "@/lib/pricing/last-purchase-net-price";
import {
  productCompatibilityImageUrls,
  productManagedImageDescriptors,
  type ProductManagedImageDescriptor,
} from "@/lib/products/product-media-read";

export interface PricingQuery {
  q?: string;
  categoryIds?: string[];
  brandIds?: string[];
  supplierIds?: string[];
  stock?: string;
  productKind?: string;
  lifecycle?: string;
  sort?: PricingSort;
  priceBookId?: string;
  warehouseId?: string;
  page?: number;
  pageSize?: number;
}

export interface PricingProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  model: string | null;
  supplierId: string | null;
  imageUrls: string[];
  imageMedia: ProductManagedImageDescriptor[];
  imageUpdatedAt: string;
  baseUnit: string;
  productKind: string;
  lifecycleStatus: string;
  trackBatches: boolean;
  shelfLifeDays: number | null;
  minStock: number;
  units: Array<{
    unitName: string;
    multiplier: number;
    barcode: string | null;
  }>;
  parentProductId: string | null;
  variantName: string | null;
  isVariantParent: boolean;
  baseRetailPrice: number;
  costPrice: number;
  lastPurchasePrice: number | null;
  lastPurchaseNetPrice: number | null;
  availableStock: number;
}

export interface PricingCategory {
  id: string;
  name: string;
}

export interface PricingProductPage {
  rows: PricingProductRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Pricing is defined over active, directly sellable SKUs only.
 * Variant parents, paused products, drafts, and archived products are excluded.
 * The same predicate is reused by listing and bulk formula mutations.
 */
export function pricingSellableProductCondition(): SQL {
  return and(
    eq(products.isVariantParent, pricingProjectionPolicy.isVariantParent),
    eq(products.isActive, pricingProjectionPolicy.isActive),
    eq(products.lifecycleStatus, pricingProjectionPolicy.lifecycleStatus),
  )!;
}

export async function getPricingPage(
  storeId: string,
  query: PricingQuery = {},
): Promise<PricingProductPage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = coercePageSize(query.pageSize, 50);
  const conditions: SQL[] = [
    eq(products.storeId, storeId),
    eq(products.isVariantParent, false),
  ];
  const availableStock = query.warehouseId?.trim()
    ? sql<string>`coalesce((
        select sl.quantity
        from ${stockLevels} sl
        where sl.product_id = ${products.id}
          and sl.store_id = ${storeId}
          and sl.warehouse_id = ${query.warehouseId.trim()}
        limit 1
      ), 0)`
    : products.totalStock;
  const lifecycle = query.lifecycle ?? "active";
  const q = query.q?.trim();
  if (q) {
    conditions.push(
      or(
        accentInsensitiveLike(products.name, q),
        accentInsensitiveLike(products.sku, q),
        accentInsensitiveLike(products.barcode, q),
      )!,
    );
  }
  if (query.categoryIds?.length) {
    conditions.push(inArray(products.categoryId, query.categoryIds));
  }
  if (query.brandIds?.length) {
    conditions.push(inArray(products.brandId, query.brandIds));
  }
  if (query.supplierIds?.length) {
    conditions.push(inArray(products.supplierId, query.supplierIds));
  }
  if (query.productKind === "variant") {
    conditions.push(
      or(
        eq(products.isVariantParent, true),
        sql`${products.parentProductId} is not null`,
      )!,
    );
  } else if (
    query.productKind === "product" ||
    query.productKind === "service" ||
    query.productKind === "combo"
  ) {
    conditions.push(eq(products.productKind, query.productKind));
  }
  if (lifecycle === "paused") {
    conditions.push(
      and(
        eq(products.lifecycleStatus, "active"),
        eq(products.isActive, false),
      )!,
    );
  } else if (
    lifecycle === "active" ||
    lifecycle === "draft" ||
    lifecycle === "archived"
  ) {
    conditions.push(eq(products.lifecycleStatus, lifecycle));
    if (lifecycle === "active") conditions.push(eq(products.isActive, true));
  }
  const stockCondition = pricingStockCondition(
    query.stock,
    availableStock,
    products.minStock,
  );
  if (stockCondition) {
    conditions.push(stockCondition);
  } else if (query.stock === "unmanaged") {
    conditions.push(eq(products.productKind, "service"));
  }
  const where = and(...conditions);
  const selectedPrice = query.priceBookId?.trim()
    ? sql<string>`(
        select case
          when b.system_type = 'cost' or b.cost_based then ${products.costPrice}
          when b.system_type = 'purchase' then ${lastPurchaseNetPriceSql(storeId)}
          when b.system_type = 'list' then (select pp.price from ${productPrices} pp where pp.product_id = ${products.id}
            and pp.store_id = ${storeId} and pp.price_book_id = b.id limit 1)
          when b.system_type = 'retail' or b.is_default then ${products.retailPrice}
          else coalesce((select pp.price from ${productPrices} pp where pp.product_id = ${products.id}
            and pp.store_id = ${storeId} and pp.price_book_id = b.id limit 1), ${products.retailPrice})
        end from ${priceBooks} b where b.store_id = ${storeId} and b.id = ${query.priceBookId.trim()} limit 1
      )`
    : products.retailPrice;
  const orderBy = pricingOrderBy(
    query.sort ?? "updated",
    selectedPrice,
    availableStock,
  );

  const [rawRows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        categoryId: products.categoryId,
        categoryName: categories.name,
        brandId: products.brandId,
        brandName: brands.name,
        model: sql<string | null>`${products.specs} ->> 'model'`,
        supplierId: products.supplierId,
        imageUrls: productCompatibilityImageUrls(storeId),
        imageMedia: productManagedImageDescriptors(storeId),
        imageUpdatedAt: products.imageUpdatedAt,
        baseUnit: products.baseUnit,
        productKind: products.productKind,
        lifecycleStatus: products.lifecycleStatus,
        trackBatches: products.trackBatches,
        shelfLifeDays: products.shelfLifeDays,
        minStock: products.minStock,
        units: sql<
          Array<{
            unitName: string;
            multiplier: string;
            barcode: string | null;
          }>
        >`coalesce((
          select json_agg(json_build_object(
            'unitName', pu.unit_name,
            'multiplier', pu.multiplier,
            'barcode', pu.barcode
          ) order by pu.sort_order)
          from ${productUnits} pu
          where pu.product_id = ${products.id}
        ), '[]')`,
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        baseRetailPrice: products.retailPrice,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        lastPurchaseNetPrice: lastPurchaseNetPriceSql(storeId),
        availableStock,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(products).where(where),
  ]);

  return {
    rows: rawRows.map((row) => ({
      id: row.id,
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      brandId: row.brandId,
      brandName: row.brandName,
      model: row.model,
      supplierId: row.supplierId,
      imageUrls: row.imageUrls ?? [],
      imageMedia: row.imageMedia ?? [],
      imageUpdatedAt: row.imageUpdatedAt.toISOString(),
      baseUnit: row.baseUnit,
      productKind: row.productKind,
      lifecycleStatus: row.lifecycleStatus,
      trackBatches: row.trackBatches,
      shelfLifeDays: row.shelfLifeDays,
      minStock: Number(row.minStock),
      units: row.units.map((unit) => ({
        unitName: unit.unitName,
        multiplier: Number(unit.multiplier),
        barcode: unit.barcode,
      })),
      parentProductId: row.parentProductId,
      variantName: row.variantName,
      isVariantParent: row.isVariantParent,
      baseRetailPrice: Number(row.baseRetailPrice),
      costPrice: Number(row.costPrice),
      lastPurchasePrice:
        row.lastPurchasePrice == null
          ? null
          : Number(row.lastPurchasePrice),
      lastPurchaseNetPrice: row.lastPurchaseNetPrice == null ? null : Number(row.lastPurchaseNetPrice),
      availableStock: Number(row.availableStock),
    })),
    total: Number(total),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)),
  };
}

export async function getPricingCategories(storeId: string): Promise<PricingCategory[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.storeId, storeId), pricingSellableProductCondition()))
    .groupBy(categories.id, categories.name)
    .orderBy(asc(categories.name), asc(categories.id));
}

export async function getPricingBrands(storeId: string): Promise<PricingCategory[]> {
  return db
    .select({ id: brands.id, name: brands.name })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .where(eq(products.storeId, storeId))
    .groupBy(brands.id, brands.name)
    .orderBy(asc(brands.name), asc(brands.id));
}

export async function getPricingSuppliers(storeId: string): Promise<PricingCategory[]> {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(products)
    .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(eq(products.storeId, storeId))
    .groupBy(suppliers.id, suppliers.name)
    .orderBy(asc(suppliers.name), asc(suppliers.id));
}

function pricingOrderBy(
  sort: PricingSort,
  selectedPrice: SQL | typeof products.retailPrice,
  availableStock: SQL | typeof products.totalStock,
): SQL[] {
  const [primarySpec] = pricingSortSpec(sort);
  const primary = (() => {
    switch (primarySpec.key) {
      case "name":
        return asc(products.name);
      case "sku":
        return asc(products.sku);
      case "costPrice":
        return desc(products.costPrice);
      case "effectivePrice":
        return desc(selectedPrice);
      case "stock":
        return asc(availableStock);
      default:
        return desc(products.updatedAt);
    }
  })();
  return [primary, asc(products.id)];
}

import {
  and,
  asc,
  count,
  desc,
  eq,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { categories, productPrices, products } from "@/db/schema";
import { coercePageSize } from "@/lib/pagination";
import { accentInsensitiveLike } from "@/lib/search";
import {
  pricingProjectionPolicy,
  pricingSortSpec,
  type PricingSort,
} from "@/lib/pricing/pricing-policy";

export interface PricingQuery {
  q?: string;
  categoryId?: string;
  sort?: PricingSort;
  priceBookId?: string;
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
  imageUrls: string[];
  parentProductId: string | null;
  variantName: string | null;
  isVariantParent: boolean;
  baseRetailPrice: number;
  costPrice: number;
  lastPurchasePrice: number;
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
  query: PricingQuery = {},
): Promise<PricingProductPage> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = coercePageSize(query.pageSize, 50);
  const conditions: SQL[] = [pricingSellableProductCondition()];
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
  if (query.categoryId?.trim()) {
    conditions.push(eq(products.categoryId, query.categoryId.trim()));
  }
  const where = and(...conditions);
  const selectedPrice = query.priceBookId?.trim()
    ? sql<string>`coalesce((
        select pp.price
        from ${productPrices} pp
        where pp.product_id = ${products.id}
          and pp.price_book_id = ${query.priceBookId.trim()}
        limit 1
      ), ${products.retailPrice})`
    : products.retailPrice;
  const orderBy = pricingOrderBy(query.sort ?? "default", selectedPrice);

  const [rawRows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        categoryId: products.categoryId,
        categoryName: categories.name,
        imageUrls: products.imageUrls,
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        baseRetailPrice: products.retailPrice,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
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
      imageUrls: row.imageUrls ?? [],
      parentProductId: row.parentProductId,
      variantName: row.variantName,
      isVariantParent: row.isVariantParent,
      baseRetailPrice: Number(row.baseRetailPrice),
      costPrice: Number(row.costPrice),
      lastPurchasePrice:
        row.lastPurchasePrice == null
          ? Number(row.costPrice)
          : Number(row.lastPurchasePrice),
    })),
    total: Number(total),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(Number(total) / pageSize)),
  };
}

export async function getPricingCategories(): Promise<PricingCategory[]> {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(pricingSellableProductCondition())
    .groupBy(categories.id, categories.name)
    .orderBy(asc(categories.name), asc(categories.id));
}

function pricingOrderBy(
  sort: PricingSort,
  selectedPrice: SQL | typeof products.retailPrice,
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
      default:
        return desc(products.updatedAt);
    }
  })();
  return [primary, asc(products.id)];
}

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  catalogSyncState,
  categories,
  productComboItems,
  productPrices,
  products,
  productUnits,
  stockLevels,
  warehouses,
} from "@/db/schema";
import { getPriceBooks } from "@/lib/data/price-books";
import { canViewPurchasePrices, resolvePriceBookPrice, systemPriceBookType } from "@/lib/pricing/system-price-books";
import { UNMANAGED_STOCK_CATEGORY_NAME } from "@/lib/product-stock";
import {
  PRODUCT_CATALOG_SCHEMA_VERSION,
  type CatalogUnit,
  type CatalogWarehouseStock,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";

export async function getProductCatalogRevision(storeId: string): Promise<string> {
  const [state] = await db
    .select({ revision: catalogSyncState.revision })
    .from(catalogSyncState)
    .where(and(eq(catalogSyncState.storeId, storeId), eq(catalogSyncState.id, 1)))
    .limit(1);
  return String(state?.revision ?? 0);
}

/** Projection đầy đủ để mọi màn hình dùng chung khi online và offline. */
export async function getProductCatalogSnapshot(
  storeId: string,
  userId: string,
  role: string,
): Promise<ProductCatalogSnapshot> {
  return buildProductCatalogSnapshot(storeId, userId, role, 0);
}

async function buildProductCatalogSnapshot(
  storeId: string,
  userId: string,
  role: string,
  attempt: number,
): Promise<ProductCatalogSnapshot> {
  const hasComplianceColumns = await hasProductComplianceColumns();
  const revisionBefore = await getProductCatalogRevision(storeId);
  const [productRows, warehouseRows, books] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        productKind: products.productKind,
        brandId: products.brandId,
        brandName: brands.name,
        model: sql<string | null>`${products.specs} ->> 'model'`,
        categoryId: products.categoryId,
        categoryName: categories.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        retailPrice: products.retailPrice,
        wholesalePrice: products.wholesalePrice,
        contractorPrice: products.contractorPrice,
        agentPrice: products.agentPrice,
        imageUrls: productCompatibilityImageUrls(storeId),
        imageUpdatedAt: products.imageUpdatedAt,
        specs: products.specs,
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        m2PerUnit: products.m2PerUnit,
        priceByWeight: hasComplianceColumns ? products.priceByWeight : sql<boolean>`false`,
        isStockManaged: sql<boolean>`(
          ${products.productKind} = 'product'
          and (
            ${categories.name} is null
            or lower(trim(${categories.name})) <> ${UNMANAGED_STOCK_CATEGORY_NAME}
          )
        )`,
        comboItems: sql<Array<{ productId: string; quantity: string }>>`coalesce((
          select json_agg(json_build_object(
            'productId', ${productComboItems.componentProductId},
            'quantity', ${productComboItems.quantity}
          ) order by ${productComboItems.sortOrder})
          from ${productComboItems}
          where ${productComboItems.storeId} = ${storeId}::uuid
            and ${productComboItems.comboProductId} = ${products.id}
        ), '[]')`,
        units: sql<CatalogUnit[]>`coalesce((
          select json_agg(json_build_object(
            'unitName', ${productUnits.unitName},
            'multiplier', ${productUnits.multiplier},
            'barcode', ${productUnits.barcode},
            'priceOverride', ${productUnits.priceOverride}
          ) order by ${productUnits.sortOrder})
          from ${productUnits}
          where ${productUnits.storeId} = ${storeId}::uuid
            and ${productUnits.productId} = ${products.id}
        ), '[]')`,
        prices: sql<Record<string, string>>`coalesce((
          select json_object_agg(${productPrices.priceBookId}, ${productPrices.price})
          from ${productPrices}
          where ${productPrices.storeId} = ${storeId}::uuid
            and ${productPrices.productId} = ${products.id}
        ), '{}')`,
        warehouseStock: sql<CatalogWarehouseStock[]>`coalesce((
          select json_agg(json_build_object(
            'warehouseId', ${stockLevels.warehouseId},
            'quantity', ${stockLevels.quantity},
            'reserved', ${stockLevels.reserved},
            'minLevel', ${stockLevels.minLevel}
          ))
          from ${stockLevels}
          where ${stockLevels.storeId} = ${storeId}::uuid
            and ${stockLevels.productId} = ${products.id}
        ), '[]')`,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(products.storeId, storeId), eq(products.isActive, true)))
      .orderBy(asc(products.name)),
    db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        isDefault: warehouses.isDefault,
      })
      .from(warehouses)
      .where(eq(warehouses.storeId, storeId))
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name)),
    getPriceBooks(storeId, { includeManagerOnly: canViewPurchasePrices(role) }),
  ]);
  const revisionAfter = await getProductCatalogRevision(storeId);
  if (revisionBefore !== revisionAfter) {
    if (attempt >= 2) throw new Error("PRODUCT_CATALOG_CHANGED_DURING_SNAPSHOT");
    return buildProductCatalogSnapshot(storeId, userId, role, attempt + 1);
  }

  return {
    schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
    userId,
    scopeId: `${storeId}:${userId}:${role}`,
    revision: revisionAfter,
    savedAt: Date.now(),
    products: productRows.map((product) => ({
      ...product,
      costPrice: canViewPurchasePrices(role) ? product.costPrice : null,
      lastPurchasePrice: canViewPurchasePrices(role) ? product.lastPurchasePrice : null,
      imageUrls: product.imageUrls ?? [],
      units: product.units.map((unit) => ({
        ...unit,
        multiplier: String(unit.multiplier),
        priceOverride: unit.priceOverride == null ? null : String(unit.priceOverride),
      })),
      priceBookTypes: Object.fromEntries(books.map((book) => [book.id, systemPriceBookType(book)])),
      prices: Object.fromEntries(
        books.map((book) => {
          const price = resolvePriceBookPrice(book, product, product.prices[book.id]);
          return [book.id, price == null ? null : String(price)];
        }),
      ),
      warehouseStock: product.warehouseStock.map((stock) => ({
        ...stock,
        quantity: String(stock.quantity),
        reserved: String(stock.reserved),
        minLevel: String(stock.minLevel ?? 0),
      })),
      updatedAt: product.updatedAt.toISOString(),
      imageUpdatedAt: product.imageUpdatedAt.toISOString(),
    })),
    warehouses: warehouseRows,
  };
}

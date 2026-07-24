import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  categories,
  productPrices,
  products,
  productUnits,
  stockLevels,
  warehouses,
} from "@/db/schema";
import { UNMANAGED_STOCK_CATEGORY_NAME } from "@/lib/product-stock";
import {
  PRODUCT_CATALOG_SCHEMA_VERSION,
  type CatalogUnit,
  type CatalogWarehouseStock,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";

/** Projection đầy đủ để mọi màn hình dùng chung khi online và offline. */
export async function getProductCatalogSnapshot(
  userId: string,
  role: string,
): Promise<ProductCatalogSnapshot> {
  const hasComplianceColumns = await hasProductComplianceColumns();
  const [productRows, warehouseRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        brandName: brands.name,
        categoryId: products.categoryId,
        categoryName: categories.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        retailPrice: products.retailPrice,
        wholesalePrice: products.wholesalePrice,
        contractorPrice: products.contractorPrice,
        agentPrice: products.agentPrice,
        imageUrls: products.imageUrls,
        specs: products.specs,
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        m2PerUnit: products.m2PerUnit,
        priceByWeight: hasComplianceColumns ? products.priceByWeight : sql<boolean>`false`,
        isStockManaged: sql<boolean>`(
          ${categories.name} is null
          or lower(trim(${categories.name})) <> ${UNMANAGED_STOCK_CATEGORY_NAME}
        )`,
        units: sql<CatalogUnit[]>`coalesce((
          select json_agg(json_build_object(
            'unitName', ${productUnits.unitName},
            'multiplier', ${productUnits.multiplier},
            'barcode', ${productUnits.barcode},
            'priceOverride', ${productUnits.priceOverride}
          ) order by ${productUnits.sortOrder})
          from ${productUnits}
          where ${productUnits.productId} = ${products.id}
        ), '[]')`,
        prices: sql<Record<string, string>>`coalesce((
          select json_object_agg(${productPrices.priceBookId}, ${productPrices.price})
          from ${productPrices}
          where ${productPrices.productId} = ${products.id}
        ), '{}')`,
        warehouseStock: sql<CatalogWarehouseStock[]>`coalesce((
          select json_agg(json_build_object(
            'warehouseId', ${stockLevels.warehouseId},
            'quantity', ${stockLevels.quantity},
            'reserved', ${stockLevels.reserved},
            'minLevel', ${stockLevels.minLevel}
          ))
          from ${stockLevels}
          where ${stockLevels.productId} = ${products.id}
        ), '[]')`,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name)),
    db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        isDefault: warehouses.isDefault,
      })
      .from(warehouses)
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name)),
  ]);

  return {
    schemaVersion: PRODUCT_CATALOG_SCHEMA_VERSION,
    userId,
    scopeId: `${userId}:${role}`,
    savedAt: Date.now(),
    products: productRows.map((product) => ({
      ...product,
      costPrice: ["owner", "manager", "warehouse"].includes(role)
        ? product.costPrice
        : null,
      imageUrls: product.imageUrls ?? [],
      units: product.units.map((unit) => ({
        ...unit,
        multiplier: String(unit.multiplier),
        priceOverride: unit.priceOverride == null ? null : String(unit.priceOverride),
      })),
      prices: Object.fromEntries(
        Object.entries(product.prices).map(([priceBookId, price]) => [priceBookId, String(price)]),
      ),
      warehouseStock: product.warehouseStock.map((stock) => ({
        ...stock,
        quantity: String(stock.quantity),
        reserved: String(stock.reserved),
        minLevel: String(stock.minLevel ?? 0),
      })),
      updatedAt: product.updatedAt.toISOString(),
    })),
    warehouses: warehouseRows,
  };
}

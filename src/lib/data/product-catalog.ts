import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  catalogSyncState,
  catalogDeltaEvents,
  catalogDeltaFloors,
  categories,
  productComboItems,
  orderItems,
  orders,
  productPrices,
  productSuppliers,
  products,
  productUnits,
  suppliers,
  stockLevels,
  warehouses,
} from "@/db/schema";
import { getPriceBooks } from "@/lib/data/price-books";
import { canViewPurchasePrices, resolvePriceBookPrice, systemPriceBookType } from "@/lib/pricing/system-price-books";
import { UNMANAGED_STOCK_CATEGORY_NAME } from "@/lib/product-stock";
import {
  PRODUCT_CATALOG_SCHEMA_VERSION,
  LEGACY_PRODUCT_CATALOG_SCHEMA_VERSION,
  sortByRecentProductSale,
  type ProductCatalogDelta,
  type CatalogUnit,
  type CatalogWarehouseStock,
  type ProductCatalogSnapshot,
  type ProductCatalogMetadataDelta,
} from "@/lib/product-catalog";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";
import { latestPurchaseNetPrices } from "@/lib/pricing/last-purchase-net-price";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";
import { changedCatalogProductIds, replayCatalogDeltaBatch } from "@/lib/catalog-delta";

export async function getProductCatalogRevision(storeId: string): Promise<string> {
  const [state] = await db
    .select({ revision: catalogSyncState.revision })
    .from(catalogSyncState)
    .where(and(eq(catalogSyncState.storeId, storeId), eq(catalogSyncState.id, 1)))
    .limit(1);
  return String(state?.revision ?? 0);
}

// Only replay a contiguous, retained revision range. A global catalog
// mutation, a pre-journal client, a pruned gap, or a large delta falls back
// to the full snapshot contract. No partial result is ever published.
export async function getProductCatalogDelta(
  storeId: string,
  userId: string,
  role: string,
  sinceRevision: string,
  expectedRevision: string,
): Promise<ProductCatalogDelta | null> {
  const since = Number(sinceRevision);
  const target = Number(expectedRevision);
  if (!Number.isSafeInteger(since) || !Number.isSafeInteger(target) ||
      since >= target || since < 0) return null;

  const [floor] = await db.select({ revision: catalogDeltaFloors.floorRevision })
    .from(catalogDeltaFloors)
    .where(eq(catalogDeltaFloors.storeId, storeId))
    .limit(1);
  if (!floor || since < floor.revision) return null;

  const events = await db.select({
    revision: catalogDeltaEvents.revision,
    productId: catalogDeltaEvents.productId,
    requiresFull: catalogDeltaEvents.requiresFull,
  }).from(catalogDeltaEvents).where(and(
    eq(catalogDeltaEvents.storeId, storeId),
    gt(catalogDeltaEvents.revision, since),
    lte(catalogDeltaEvents.revision, target),
  )).orderBy(asc(catalogDeltaEvents.revision)).limit(2001);

  // Gap, stale history, cross-product change or oversized patch => full.
  const changedIds = changedCatalogProductIds(since, target, events);
  if (!changedIds) return null;

  const partial = await getProductCatalogSnapshot(storeId, userId, role, {
    includeInactive: true,
    productIds: changedIds,
    includeMetadata: false,
    schemaVersion: LEGACY_PRODUCT_CATALOG_SCHEMA_VERSION,
  });
  // Snapshot builders retry when a revision changes during hydration. A
  // changed revision here means our journal window is already stale.
  if (partial.revision !== expectedRevision) return null;

  const liveIds = new Set(partial.products.map((product) => product.id));
  return {
    baseRevision: sinceRevision,
    revision: expectedRevision,
    schemaVersion: partial.schemaVersion,
    userId: partial.userId,
    scopeId: partial.scopeId,
    upserts: partial.products,
    deletedIds: changedIds.filter((id) => !liveIds.has(id)),
  };
}

const CATALOG_DELTA_PAGE_SIZE = 200;

/**
 * Build one bounded V2 delta page. Product rows are hydrated only for the
 * affected IDs; metadata renames travel independently from product rows.
 */
export async function getProductCatalogDeltaV2(
  storeId: string,
  userId: string,
  role: string,
  sinceRevision: string,
  expectedRevision: string,
): Promise<ProductCatalogDelta | null> {
  const since = Number(sinceRevision);
  const target = Number(expectedRevision);
  if (!Number.isSafeInteger(since) || !Number.isSafeInteger(target) || since < 0 || since >= target) return null;

  const [floor] = await db.select({ revision: catalogDeltaFloors.floorRevision })
    .from(catalogDeltaFloors)
    .where(eq(catalogDeltaFloors.storeId, storeId))
    .limit(1);
  if (!floor || since < floor.revision) return null;

  const events = await db.select({
    revision: catalogDeltaEvents.revision,
    changeKind: catalogDeltaEvents.changeKind,
    entityType: catalogDeltaEvents.entityType,
    entityId: catalogDeltaEvents.entityId,
    affectedProductIds: catalogDeltaEvents.affectedProductIds,
    requiresFullV2: catalogDeltaEvents.requiresFullV2,
  }).from(catalogDeltaEvents).where(and(
    eq(catalogDeltaEvents.storeId, storeId),
    gt(catalogDeltaEvents.revision, since),
    lte(catalogDeltaEvents.revision, target),
  )).orderBy(asc(catalogDeltaEvents.revision)).limit(CATALOG_DELTA_PAGE_SIZE + 1);

  const batch = replayCatalogDeltaBatch(since, target, events, CATALOG_DELTA_PAGE_SIZE);
  if (!batch) return null;

  const partial = await getProductCatalogSnapshot(storeId, userId, role, {
    includeInactive: true,
    productIds: batch.productIds,
    includeMetadata: false,
  });
  if (partial.revision !== expectedRevision) return null;

  const metadata = await getCatalogMetadataDelta(storeId, batch.metadataIds);
  const liveIds = new Set(partial.products.map((product) => product.id));
  return {
    baseRevision: batch.fromRevision,
    revision: batch.toRevision,
    schemaVersion: partial.schemaVersion,
    userId: partial.userId,
    scopeId: partial.scopeId,
    upserts: partial.products,
    deletedIds: batch.productIds.filter((id) => !liveIds.has(id)),
    metadata,
    hasMore: batch.hasMore,
  };
}

async function getCatalogMetadataDelta(
  storeId: string,
  ids: Partial<Record<"categories" | "brands" | "suppliers" | "warehouses", string[]>>,
): Promise<ProductCatalogMetadataDelta> {
  const [categoryRows, brandRows, supplierRows, warehouseRows] = await Promise.all([
    ids.categories?.length
      ? db.select({ id: categories.id, name: categories.name }).from(categories)
        .where(and(eq(categories.storeId, storeId), inArray(categories.id, ids.categories)))
      : Promise.resolve([]),
    ids.brands?.length
      ? db.select({ id: brands.id, name: brands.name }).from(brands)
        .where(and(eq(brands.storeId, storeId), inArray(brands.id, ids.brands)))
      : Promise.resolve([]),
    ids.suppliers?.length
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
        .where(and(eq(suppliers.storeId, storeId), inArray(suppliers.id, ids.suppliers)))
      : Promise.resolve([]),
    ids.warehouses?.length
      ? db.select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
        .from(warehouses).where(and(eq(warehouses.storeId, storeId), inArray(warehouses.id, ids.warehouses)))
      : Promise.resolve([]),
  ]);
  return {
    ...(ids.categories ? { categories: { upserts: categoryRows, deletedIds: ids.categories.filter((id) => !categoryRows.some((row) => row.id === id)) } } : {}),
    ...(ids.brands ? { brands: { upserts: brandRows, deletedIds: ids.brands.filter((id) => !brandRows.some((row) => row.id === id)) } } : {}),
    ...(ids.suppliers ? { suppliers: { upserts: supplierRows, deletedIds: ids.suppliers.filter((id) => !supplierRows.some((row) => row.id === id)) } } : {}),
    ...(ids.warehouses ? { warehouses: { upserts: warehouseRows, deletedIds: ids.warehouses.filter((id) => !warehouseRows.some((row) => row.id === id)) } } : {}),
  };
}

/** Projection đầy đủ để mọi màn hình dùng chung khi online và offline. */
export async function getProductCatalogSnapshot(
  storeId: string,
  userId: string,
  role: string,
  options: {
    includeInactive?: boolean;
    productIds?: readonly string[];
    includeMetadata?: boolean;
    schemaVersion?: number;
  } = {},
): Promise<ProductCatalogSnapshot> {
  return buildProductCatalogSnapshot(storeId, userId, role, 0, options);
}

async function buildProductCatalogSnapshot(
  storeId: string,
  userId: string,
  role: string,
  attempt: number,
  options: {
    includeInactive?: boolean;
    productIds?: readonly string[];
    includeMetadata?: boolean;
    schemaVersion?: number;
  },
): Promise<ProductCatalogSnapshot> {
  const hasComplianceColumns = await hasProductComplianceColumns();
  const revisionBefore = await getProductCatalogRevision(storeId);
  const includeMetadata = options.includeMetadata ?? !options.productIds;
  const [productRows, recentSaleRows, warehouseRows, books, categoryRows, brandRows, supplierRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        description: products.description,
        location: products.location,
        weight: products.weight,
        dimensions: products.dimensions,
        createdAt: products.createdAt,
        productKind: products.productKind,
        isActive: products.isActive,
        lifecycleStatus: products.lifecycleStatus,
        trackBatches: products.trackBatches,
        supplierId: products.supplierId,
        supplierName: suppliers.name,
        supplierIDs: sql<string[]> `coalesce((
          select json_agg(distinct ${productSuppliers.supplierId})
          from ${productSuppliers}
          where ${productSuppliers.storeId} = ${storeId}::uuid
            and ${productSuppliers.productId} = ${products.id}
        ), '[]')`,
        minStock: products.minStock,
        totalStock: products.totalStock,
        brandId: products.brandId,
        brandName: brands.name,
        model: sql<string | null>`${products.specs} ->> 'model'`,
        categoryId: products.categoryId,
        categoryName: categories.name,
        baseUnit: products.baseUnit,
        baseUnitDirectSale: products.baseUnitDirectSale,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        lastPurchaseNetPrice: sql<string | null>`null`,
        retailPrice: products.retailPrice,
        wholesalePrice: products.wholesalePrice,
        contractorPrice: products.contractorPrice,
        agentPrice: products.agentPrice,
        imageUrls: productCompatibilityImageUrls(storeId),
        imageUpdatedAt: products.imageUpdatedAt,
        specs: products.specs,
        parentProductId: products.parentProductId,
        relatedProductId: products.relatedProductId,
        variantGroupId: sql<string | null>`(select product_variant_members.group_id from product_variant_members where product_variant_members.store_id = ${storeId}::uuid and product_variant_members.product_id = ${products.id} limit 1)`,
        variantGroupKind: sql<string | null>`(select product_variant_groups.kind from product_variant_groups where product_variant_groups.store_id = ${storeId}::uuid and product_variant_groups.id = (select product_variant_members.group_id from product_variant_members where product_variant_members.store_id = ${storeId}::uuid and product_variant_members.product_id = ${products.id} limit 1) limit 1)`,
        combinationKey: sql<string | null>`(select product_variant_members.combination_key from product_variant_members where product_variant_members.store_id = ${storeId}::uuid and product_variant_members.product_id = ${products.id} limit 1)`,
        optionValueIds: sql<string[]>`coalesce((select product_variant_members.option_value_ids from product_variant_members where product_variant_members.store_id = ${storeId}::uuid and product_variant_members.product_id = ${products.id} limit 1), '[]'::jsonb)`,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        m2PerUnit: products.m2PerUnit,
        priceByWeight: hasComplianceColumns ? products.priceByWeight : sql<boolean>`false`,
        vatRate: hasComplianceColumns ? products.vatRate : sql<string | null>`null`,
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
            'sku', ${productUnits.sku},
            'barcode', ${productUnits.barcode},
            'priceOverride', ${productUnits.priceOverride},
            'directSale', ${productUnits.directSale}
          ) order by ${productUnits.sortOrder})
          from ${productUnits}
          where ${productUnits.storeId} = ${storeId}::uuid
            and ${productUnits.productId} = products.id
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
      .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(and(
        eq(products.storeId, storeId),
        options.includeInactive ? undefined : eq(products.isActive, true),
        options.productIds ? inArray(products.id, [...options.productIds]) : undefined,
      ))
      .orderBy(asc(products.name), asc(products.id)),
    db
      .select({
        productId: orderItems.productId,
        parentProductId: products.parentProductId,
        lastSoldAt: sql<Date>`max(${orders.createdAt})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(and(
        eq(orders.storeId, storeId), eq(orders.status, "completed"),
        options.productIds ? inArray(orderItems.productId, [...options.productIds]) : undefined,
      ))
      .groupBy(orderItems.productId, products.parentProductId),
    includeMetadata ? db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        isDefault: warehouses.isDefault,
      })
      .from(warehouses)
      .where(eq(warehouses.storeId, storeId))
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name)) : Promise.resolve([]),
    getPriceBooks(storeId, { includeManagerOnly: canViewPurchasePrices(role) }),
    includeMetadata
      ? db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.storeId, storeId)).orderBy(asc(categories.sortOrder), asc(categories.name))
      : Promise.resolve([]),
    includeMetadata
      ? db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.storeId, storeId)).orderBy(asc(brands.name))
      : Promise.resolve([]),
    includeMetadata
      ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.storeId, storeId)).orderBy(asc(suppliers.name))
      : Promise.resolve([]),
  ]);
  const purchaseNetPriceByProductId = canViewPurchasePrices(role)
    ? await latestPurchaseNetPrices(storeId, productRows.map((product) => product.id))
    : new Map<string, string>();
  const revisionAfter = await getProductCatalogRevision(storeId);
  if (revisionBefore !== revisionAfter) {
    if (attempt >= 2) throw new Error("PRODUCT_CATALOG_CHANGED_DURING_SNAPSHOT");
    return buildProductCatalogSnapshot(storeId, userId, role, attempt + 1, options);
  }

  const lastSoldAtByProduct = new Map<string, Date | string>();
  for (const sale of recentSaleRows) {
    const candidates = [sale.productId, sale.parentProductId].filter(Boolean) as string[];
    for (const productId of candidates) {
      const current = lastSoldAtByProduct.get(productId);
      if (!current || new Date(sale.lastSoldAt).getTime() > new Date(current).getTime()) {
        lastSoldAtByProduct.set(productId, sale.lastSoldAt);
      }
    }
  }
  const orderedProductRows = sortByRecentProductSale(productRows.map((product) => ({
    ...product,
    lastPurchaseNetPrice: purchaseNetPriceByProductId.get(product.id) ?? null,
    lastSoldAt: lastSoldAtByProduct.get(product.id)
      ? new Date(lastSoldAtByProduct.get(product.id)!).toISOString()
      : null,
  })));

  return {
    schemaVersion: options.schemaVersion ?? PRODUCT_CATALOG_SCHEMA_VERSION,
    userId,
    scopeId: `${storeId}:${userId}:${role}`,
    revision: revisionAfter,
    savedAt: Date.now(),
    products: orderedProductRows.map((product) => ({
      ...product,
      costPrice: canViewPurchasePrices(role) ? product.costPrice : null,
      lastPurchasePrice: canViewPurchasePrices(role) ? product.lastPurchasePrice : null,
      lastPurchaseNetPrice: canViewPurchasePrices(role) ? product.lastPurchaseNetPrice : null,
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
      createdAt: product.createdAt.toISOString(),
      lastSoldAt: lastSoldAtByProduct.get(product.id)
        ? new Date(lastSoldAtByProduct.get(product.id)!).toISOString()
        : null,
      imageUpdatedAt: product.imageUpdatedAt.toISOString(),
    })),
    warehouses: warehouseRows,
    ...(includeMetadata ? { metadata: { categories: categoryRows, brands: brandRows, suppliers: supplierRows } } : {}),
  };
}

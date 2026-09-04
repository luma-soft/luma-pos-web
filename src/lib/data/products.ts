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
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import {
  brands,
  categories,
  products,
  productComboItems,
  productUnits,
  productSuppliers,
  stockLevels,
  stockMovements,
  suppliers,
  warehouses,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { lastPurchaseNetPriceSql } from "@/lib/pricing/last-purchase-net-price";
import { coercePageSize, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import {
  hasProductComplianceColumns,
  hasProductRelatedColumn,
} from "@/lib/db/schema-compat";
import {
  DEFAULT_PRODUCT_LIST_SORT,
  type ProductListSort,
} from "@/lib/inventory/product-list-policy";
import {
  productCompatibilityImageUrls,
  productManagedImageDescriptors,
  type ProductManagedImageDescriptor,
} from "@/lib/products/product-media-read";
import {
  buildRelatedProductLookup,
  selectRelatedProducts,
} from "@/lib/products/related-products";
import { projectVariantGroup, type StoredVariantGroup, type StoredVariantMember, type VariantCatalogEntry } from "@/lib/products/variant-group-read";

export const PRODUCTS_PAGE_SIZE = 20;

/** active = chỉ đang bán (mặc định), inactive = ngừng bán, all = tất cả. */
export type ProductStatusFilter = "active" | "inactive" | "draft" | "archived" | "all";
export type ProductListView = "grouped" | "flat";

export interface ProductListFilters {
  exactProductId?: string;
  q?: string;
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  productKind?: "product" | "service" | "combo";
  stock?: "instock" | "low" | "out";
  sort?: ProductListSort;
  status?: ProductStatusFilter;
  view?: ProductListView;
  /** Keep legacy clients flat for imported KiotViet related-product families. */
  groupRelated?: boolean;
  updatedSince?: string;
  page?: number;
  pageSize?: number;
  productSkus?: readonly string[];
  cameraMaterial?: boolean;
  categoryIds?: readonly string[];
  brandIds?: readonly string[];
  supplierIds?: readonly string[];
  warehouseId?: string;
}

export const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

function productMediaCoordinates(storeId: string) {
  return productManagedImageDescriptors(storeId);
}

function withProductMedia<
  T extends { imageMediaRecords: ProductManagedImageDescriptor[] },
>(row: T) {
  const { imageMediaRecords, ...product } = row;
  return {
    ...product,
    imageMedia: imageMediaRecords,
  };
}

function productComplianceFields(hasColumns: boolean) {
  return {
    vatRate: hasColumns ? products.vatRate : sql<string | null>`null`,
    priceByWeight: hasColumns ? products.priceByWeight : sql<boolean>`false`,
    trackBatches: hasColumns ? products.trackBatches : sql<boolean>`false`,
    shelfLifeDays: hasColumns ? products.shelfLifeDays : sql<number | null>`null`,
    lifecycleStatus: hasColumns
      ? products.lifecycleStatus
      : sql<string>`case when ${products.isActive} then 'active' else 'archived' end`,
  };
}

/** All filters must match the same sellable SKU, including inside a group. */
function productFilterPredicate(alias: "member" | "products", storeId: string, filters: ProductListFilters, hasCompliance: boolean, groupSearch?: SQL) {
  const field = (name: string) => sql.raw(`${alias}.${name}`);
  const conditions: SQL[] = [];
  const status = filters.status ?? "active";
  if (status === "active") conditions.push(sql`${field("is_active")} = true`);
  else if (status === "inactive") conditions.push(sql`${field("is_active")} = false`);
  else if (hasCompliance && (status === "draft" || status === "archived")) conditions.push(sql`${field("lifecycle_status")} = ${status}`);
  const q = filters.q?.trim();
  if (q) conditions.push(or(
    accentInsensitiveLike(field("name"), q), accentInsensitiveLike(field("sku"), q),
    accentInsensitiveLike(field("barcode"), q), accentInsensitiveLike(sql`${field("specs")}::text`, q),
    groupSearch,
  )!);
  for (const [column, single, multiple] of [
    ["category_id", filters.categoryId, filters.categoryIds],
    ["brand_id", filters.brandId, filters.brandIds],
    ["supplier_id", filters.supplierId, filters.supplierIds],
  ] as const) {
    const ids = single ? [single] : multiple;
    if (ids?.length) conditions.push(inArray(field(column), [...ids]));
  }
  if (filters.productKind) conditions.push(sql`${field("product_kind")} = ${filters.productKind}`);
  const quantity = sql`coalesce((select sum(filter_stock.quantity) from stock_levels filter_stock
    where filter_stock.store_id = ${storeId} and filter_stock.product_id = ${field("id")}
      ${filters.warehouseId ? sql`and filter_stock.warehouse_id = ${filters.warehouseId}` : sql``}), 0)`;
  if (filters.stock === "instock") conditions.push(sql`${quantity} > 0`);
  else if (filters.stock === "out") conditions.push(sql`${quantity} <= 0`);
  else if (filters.stock === "low") conditions.push(sql`${quantity} > 0 and ${quantity} <= ${field("min_stock")}`);
  if (filters.updatedSince) {
    const since = new Date(filters.updatedSince);
    if (!Number.isNaN(since.getTime())) conditions.push(sql`${field("updated_at")} >= ${since.toISOString()}`);
  }
  if (filters.cameraMaterial) conditions.push(or(
    filters.productSkus?.length ? inArray(field("sku"), [...filters.productSkus]) : undefined,
    sql`${field("specs")}->>'__cameraQuoteMaterial' = 'true'`,
  )!);
  else if (filters.productSkus?.length) conditions.push(inArray(field("sku"), [...filters.productSkus]));
  return and(...conditions) ?? sql`true`;
}

async function getBaseProducts(storeId: string, filters: ProductListFilters = {}, internal: { productIds?: readonly string[]; includeDetails?: boolean } = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = internal.productIds ? Math.max(1, internal.productIds.length) : coercePageSize(filters.pageSize, DEFAULT_PAGE_SIZE);
  const sort = filters.sort ?? "name";
  const view: ProductListView = filters.view ?? "grouped";
  const [hasComplianceColumns, hasRelatedProducts] = await Promise.all([
    hasProductComplianceColumns(),
    hasProductRelatedColumn(),
  ]);
  const complianceFields = productComplianceFields(hasComplianceColumns);
  const relatedProductIdField = hasRelatedProducts
    ? products.relatedProductId
    : sql<string | null>`null`;
  const groupRelated = filters.groupRelated !== false;
  const conditions: SQL[] = [eq(products.storeId, storeId)];
  const exactProductId = filters.exactProductId;
  const relatedLink = hasRelatedProducts && groupRelated ? sql`member.related_product_id = ${products.id}` : sql`false`;
  const actualMember = sql`member.store_id = ${storeId} and member.is_variant_parent = false and (
    member.parent_product_id = ${products.id} or ${relatedLink} or member.id = ${products.id}
  )`;
  const stockJoin = and(eq(stockLevels.productId, products.id), eq(stockLevels.storeId, storeId),
    filters.warehouseId ? eq(stockLevels.warehouseId, filters.warehouseId) : undefined);

  if (internal.productIds) {
    conditions.push(inArray(products.id, [...internal.productIds]));
  } else if (exactProductId) {
    conditions.push(eq(products.id, exactProductId));
  } else {
    const match = productFilterPredicate(view === "grouped" ? "member" : "products", storeId, filters, hasComplianceColumns,
      view === "grouped" && filters.q?.trim() ? or(accentInsensitiveLike(products.name, filters.q.trim()), accentInsensitiveLike(products.sku, filters.q.trim())) : undefined);
    if (view === "grouped") {
      conditions.push(sql`${products.parentProductId} is null`);
      if (hasRelatedProducts && groupRelated) conditions.push(sql`(${products.relatedProductId} is null or ${products.relatedProductId} = ${products.id}
        or not exists (select 1 from products root where root.store_id = ${storeId} and root.id = ${products.relatedProductId}))`);
      conditions.push(sql`exists (select 1 from products member where ${actualMember} and ${match})`);
    } else {
      conditions.push(eq(products.isVariantParent, false), match);
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const groupStockForSort = view === "grouped" && !exactProductId && !internal.productIds
    ? sql`(select case when count(distinct member.base_unit) <= 1 then coalesce(sum(group_stock.quantity), 0) else null end
        from products member left join stock_levels group_stock on group_stock.product_id = member.id and group_stock.store_id = ${storeId}
          ${filters.warehouseId ? sql`and group_stock.warehouse_id = ${filters.warehouseId}` : sql``}
        where ${actualMember})`
    : sql`coalesce(sum(${stockLevels.quantity}), 0)`;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        productKind: products.productKind,
        barcode: products.barcode,
        name: products.name,
        description: products.description,
        categoryId: products.categoryId,
        brandId: products.brandId,
        supplierId: products.supplierId,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        lastPurchaseNetPrice: lastPurchaseNetPriceSql(storeId),
        retailPrice: products.retailPrice,
        wholesalePrice: products.wholesalePrice,
        contractorPrice: products.contractorPrice,
        agentPrice: products.agentPrice,
        vatRate: complianceFields.vatRate,
        priceByWeight: complianceFields.priceByWeight,
        trackBatches: complianceFields.trackBatches,
        shelfLifeDays: complianceFields.shelfLifeDays,
        lifecycleStatus: complianceFields.lifecycleStatus,
        relatedProductId: relatedProductIdField,
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        isActive: products.isActive,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        categoryName: categories.name,
        brandName: brands.name,
        location: products.location,
        weight: products.weight,
        dimensions: products.dimensions,
        specs: products.specs,
        imageUrls: productCompatibilityImageUrls(storeId),
        imageMediaRecords: productMediaCoordinates(storeId),
        imageUpdatedAt: products.imageUpdatedAt,
        comboItems: sql<Array<{
          productId: string;
          name: string;
          sku: string;
          baseUnit: string;
          quantity: string;
          productKind: "product" | "service";
        }>>`coalesce((
          select json_agg(json_build_object(
            'productId', pci.component_product_id,
            'name', component.name,
            'sku', component.sku,
            'baseUnit', component.base_unit,
            'quantity', pci.quantity,
            'productKind', component.product_kind
          ) order by pci.sort_order)
          from product_combo_items pci
          join products component on component.id = pci.component_product_id
          where pci.combo_product_id = ${products.id}
            and pci.store_id = ${storeId}
        ), '[]')`,
        childCount: sql<number>`(
          select count(*)::int from products child where child.store_id = ${storeId} and child.parent_product_id = ${products.id}
        )`,
        minCostPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select min(child.cost_price) from products child where child.store_id = ${storeId} and child.parent_product_id = ${products.id}
        ), ${products.costPrice}) else ${products.costPrice} end`,
        maxCostPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select max(child.cost_price) from products child where child.store_id = ${storeId} and child.parent_product_id = ${products.id}
        ), ${products.costPrice}) else ${products.costPrice} end`,
        minRetailPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select min(child.retail_price) from products child where child.store_id = ${storeId} and child.parent_product_id = ${products.id}
        ), ${products.retailPrice}) else ${products.retailPrice} end`,
        maxRetailPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select max(child.retail_price) from products child where child.store_id = ${storeId} and child.parent_product_id = ${products.id}
        ), ${products.retailPrice}) else ${products.retailPrice} end`,
        totalStock: sql<string>`case when ${products.isVariantParent} then (
          select coalesce(sum(sl.quantity), 0)
          from products child
          left join stock_levels sl on sl.product_id = child.id
          where child.parent_product_id = ${products.id}
            and child.store_id = ${storeId}
        ) else coalesce(sum(${stockLevels.quantity}), 0) end`,
        reservedStock: sql<string>`case when ${products.isVariantParent} then (
          select coalesce(sum(sl.reserved), 0)
          from products child
          left join stock_levels sl on sl.product_id = child.id
          where child.parent_product_id = ${products.id}
            and child.store_id = ${storeId}
        ) else coalesce(sum(${stockLevels.reserved}), 0) end`,
        minLevel: sql<string>`case when ${products.isVariantParent} then (
          select coalesce(max(sl.min_level), 0)
          from products child
          left join stock_levels sl on sl.product_id = child.id
          where child.parent_product_id = ${products.id}
            and child.store_id = ${storeId}
        ) else coalesce(max(${stockLevels.minLevel}), 0) end`,
        unitNames: sql<string | null>`(
          select string_agg(${productUnits.unitName}, ', ' order by ${productUnits.sortOrder})
          from ${productUnits} where ${productUnits.productId} = ${products.id}
        )`,
        unitDefinitions: sql<Array<{
          unitName: string;
          multiplier: string;
          priceOverride: string | null;
        }>>`coalesce((
          select json_agg(json_build_object(
            'unitName', ${productUnits.unitName},
            'multiplier', ${productUnits.multiplier},
            'priceOverride', ${productUnits.priceOverride}
          ) order by ${productUnits.sortOrder})
          from ${productUnits}
          where ${productUnits.productId} = ${products.id}
        ), '[]'::json)`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(stockLevels, stockJoin)
      .where(where)
      .groupBy(products.id, categories.name, brands.name)
      .orderBy(
        sort === "stock"
          ? sql`${groupStockForSort} desc nulls last`
          : sort === "updated"
            ? desc(products.updatedAt)
            : asc(products.name),
        asc(products.id),
      )
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(products).where(where),
  ]);

  const parentIds =
    (view === "grouped" || Boolean(exactProductId))
      ? rows.filter((row) => row.isVariantParent).map((row) => row.id)
      : [];
  const children =
    parentIds.length > 0
      ? await db
          .select({
            id: products.id,
            sku: products.sku,
            productKind: products.productKind,
            barcode: products.barcode,
            name: products.name,
            description: products.description,
            categoryId: products.categoryId,
            brandId: products.brandId,
            supplierId: products.supplierId,
            baseUnit: products.baseUnit,
            costPrice: products.costPrice,
            lastPurchasePrice: products.lastPurchasePrice,
            lastPurchaseNetPrice: lastPurchaseNetPriceSql(storeId),
            retailPrice: products.retailPrice,
            wholesalePrice: products.wholesalePrice,
            contractorPrice: products.contractorPrice,
            agentPrice: products.agentPrice,
            vatRate: complianceFields.vatRate,
            priceByWeight: complianceFields.priceByWeight,
            trackBatches: complianceFields.trackBatches,
            shelfLifeDays: complianceFields.shelfLifeDays,
            lifecycleStatus: complianceFields.lifecycleStatus,
            relatedProductId: relatedProductIdField,
            parentProductId: products.parentProductId,
            variantName: products.variantName,
            isVariantParent: products.isVariantParent,
            isActive: products.isActive,
            createdAt: products.createdAt,
            updatedAt: products.updatedAt,
            categoryName: categories.name,
            brandName: brands.name,
            location: products.location,
            weight: products.weight,
            dimensions: products.dimensions,
            specs: products.specs,
            imageUrls: productCompatibilityImageUrls(storeId),
            imageMediaRecords: productMediaCoordinates(storeId),
            imageUpdatedAt: products.imageUpdatedAt,
            comboItems: sql<never[]>`'[]'::json`,
            childCount: sql<number>`0`,
            minCostPrice: products.costPrice,
            maxCostPrice: products.costPrice,
            minRetailPrice: products.retailPrice,
            maxRetailPrice: products.retailPrice,
            totalStock: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)`,
            reservedStock: sql<string>`coalesce(sum(${stockLevels.reserved}), 0)`,
            minLevel: sql<string>`coalesce(max(${stockLevels.minLevel}), 0)`,
            unitNames: sql<string | null>`(
            select string_agg(${productUnits.unitName}, ', ' order by ${productUnits.sortOrder})
            from ${productUnits} where ${productUnits.productId} = ${products.id}
          )`,
            unitDefinitions: sql<Array<{
              unitName: string;
              multiplier: string;
              priceOverride: string | null;
            }>>`coalesce((
              select json_agg(json_build_object(
                'unitName', ${productUnits.unitName},
                'multiplier', ${productUnits.multiplier},
                'priceOverride', ${productUnits.priceOverride}
              ) order by ${productUnits.sortOrder})
              from ${productUnits}
              where ${productUnits.productId} = ${products.id}
            ), '[]'::json)`,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .leftJoin(brands, eq(products.brandId, brands.id))
          .leftJoin(stockLevels, stockJoin)
          .where(and(eq(products.storeId, storeId), inArray(products.parentProductId, parentIds)))
          .groupBy(products.id, categories.name, brands.name)
          .orderBy(
            sort === "stock"
              ? desc(products.totalStock)
              : sort === "updated"
                ? desc(products.updatedAt)
                : asc(products.name),
            asc(products.id),
          )
      : [];

  const childrenByParent = new Map<string, typeof children>();
  for (const child of children) {
    if (!child.parentProductId) continue;
    const group = childrenByParent.get(child.parentProductId) ?? [];
    group.push(child);
    childrenByParent.set(child.parentProductId, group);
  }

  const physicalProductIds = [
    ...new Set([
      ...rows.map((row) => row.id),
      ...children.map((child) => child.id),
    ]),
  ];
  const displayIdByProductId = new Map<string, string>();
  const displayStockById = new Map<string, number>();
  for (const row of rows) {
    displayIdByProductId.set(row.id, row.id);
    displayStockById.set(row.id, Number(row.totalStock));
    if (row.isVariantParent) {
      for (const child of childrenByParent.get(row.id) ?? [])
        displayIdByProductId.set(child.id, row.id);
    }
  }

  const stockLocationRows =
    physicalProductIds.length > 0 && internal.includeDetails !== false
      ? await db
          .select({
            productId: stockLevels.productId,
            warehouseId: stockLevels.warehouseId,
            warehouseName: warehouses.name,
            isDefaultWarehouse: warehouses.isDefault,
            quantity: stockLevels.quantity,
            reserved: stockLevels.reserved,
            minLevel: stockLevels.minLevel,
          })
          .from(stockLevels)
          .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
          .where(and(eq(stockLevels.storeId, storeId), inArray(stockLevels.productId, physicalProductIds)))
          .orderBy(desc(warehouses.isDefault), asc(warehouses.name))
      : [];

  const stockLocationsByDisplay = new Map<
    string,
    Map<
      string,
      {
        warehouseId: string;
        warehouseName: string;
        quantity: number;
        reserved: number;
        minLevel: number;
      }
    >
  >();
  for (const level of stockLocationRows) {
    const displayId = displayIdByProductId.get(level.productId);
    if (!displayId) continue;
    const group =
      stockLocationsByDisplay.get(displayId) ??
      new Map<
        string,
        {
          warehouseId: string;
          warehouseName: string;
          quantity: number;
          reserved: number;
          minLevel: number;
        }
      >();
    const current = group.get(level.warehouseId) ?? {
      warehouseId: level.warehouseId,
      warehouseName: level.warehouseName,
      quantity: 0,
      reserved: 0,
      minLevel: 0,
    };
    current.quantity += Number(level.quantity);
    current.reserved += Number(level.reserved);
    current.minLevel = Math.max(current.minLevel, Number(level.minLevel ?? 0));
    group.set(level.warehouseId, current);
    stockLocationsByDisplay.set(displayId, group);
  }

  const movementRows =
    physicalProductIds.length > 0 && internal.includeDetails !== false
      ? await db
          .select({
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
            when ${stockMovements.refType} = 'order' then (select o.code from orders o where o.id = ${stockMovements.refId} limit 1)
            when ${stockMovements.refType} = 'purchase' then (select po.code from purchase_orders po where po.id = ${stockMovements.refId} limit 1)
            when ${stockMovements.refType} = 'return' then (select r.code from returns r where r.id = ${stockMovements.refId} limit 1)
            when ${stockMovements.refType} = 'stocktake' then (select st.code from stocktakes st where st.id = ${stockMovements.refId} limit 1)
            when ${stockMovements.refType} = 'internal_use' then (select iu.code from internal_use_issues iu where iu.id = ${stockMovements.refId} limit 1)
            else ${stockMovements.note}
          end`,
            partnerName: sql<string | null>`case
            when ${stockMovements.refType} = 'order' then coalesce((
              select c.name from orders o left join customers c on c.id = o.customer_id where o.id = ${stockMovements.refId} limit 1
            ), 'Khách lẻ')
            when ${stockMovements.refType} = 'purchase' then (
              select s.name from purchase_orders po left join suppliers s on s.id = po.supplier_id where po.id = ${stockMovements.refId} limit 1
            )
            else null
          end`,
            transactionPrice: sql<string | null>`case
            when ${stockMovements.refType} = 'order' then (
              select oi.unit_price from order_items oi where oi.order_id = ${stockMovements.refId} and oi.product_id = ${stockMovements.productId} limit 1
            )
            when ${stockMovements.refType} = 'purchase' then (
              select poi.unit_cost from purchase_order_items poi where poi.purchase_order_id = ${stockMovements.refId} and poi.product_id = ${stockMovements.productId} limit 1
            )
            else null
          end`,
          })
          .from(stockMovements)
          .where(and(eq(stockMovements.storeId, storeId), inArray(stockMovements.productId, physicalProductIds)))
          .orderBy(desc(stockMovements.createdAt))
          .limit(300)
      : [];

  const movementRowsByDisplay = new Map<string, typeof movementRows>();
  for (const movement of movementRows) {
    const displayId = displayIdByProductId.get(movement.productId);
    if (!displayId) continue;
    const group = movementRowsByDisplay.get(displayId) ?? [];
    if (group.length < 12) group.push(movement);
    movementRowsByDisplay.set(displayId, group);
  }

  const stockMovementsByDisplay = new Map<
    string,
    Array<(typeof movementRows)[number] & { stockAfter: string }>
  >();
  for (const [displayId, group] of movementRowsByDisplay.entries()) {
    let balance = displayStockById.get(displayId) ?? 0;
    stockMovementsByDisplay.set(
      displayId,
      group.map((movement) => {
        const stockAfter = balance;
        balance -= Number(movement.quantity);
        return { ...movement, stockAfter: String(stockAfter) };
      }),
    );
  }

  const relatedLookup = internal.includeDetails === false ? null : buildRelatedProductLookup(hasRelatedProducts, rows);
  const relatedWhere = relatedLookup
    ? or(
        inArray(products.relatedProductId, relatedLookup.groupKeys),
        relatedLookup.rootIds.length > 0
          ? inArray(products.id, relatedLookup.rootIds)
          : undefined,
      )
    : undefined;
  const relatedCandidates = relatedWhere
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          categoryId: products.categoryId,
          relatedProductId: products.relatedProductId,
          parentProductId: products.parentProductId,
          variantName: products.variantName,
          baseUnit: products.baseUnit,
          retailPrice: products.retailPrice,
          costPrice: products.costPrice,
          isActive: products.isActive,
          totalStock: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)`,
          reservedStock: sql<string>`coalesce(sum(${stockLevels.reserved}), 0)`,
        })
        .from(products)
        .leftJoin(stockLevels, stockJoin)
        .where(and(eq(products.storeId, storeId), relatedWhere))
        .groupBy(products.id)
        .orderBy(asc(products.sku))
    : [];

  return {
    rows: rows.map((row) => {
      const productRow = withProductMedia(row);
      const relatedProducts = selectRelatedProducts(row, relatedCandidates);
      return {
        ...productRow,
        children: (childrenByParent.get(row.id) ?? []).map(withProductMedia),
        stockLocations: Array.from(
          stockLocationsByDisplay.get(row.id)?.values() ?? [],
        ),
        stockMovements: stockMovementsByDisplay.get(row.id) ?? [],
        relatedProducts,
      };
    }),
    total,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
}

type BaseProductListResult = Awaited<ReturnType<typeof getBaseProducts>>;
type BaseProductListRow = BaseProductListResult["rows"][number];
export type ProductVariantGroup = ReturnType<typeof projectVariantGroup<BaseProductListRow>>;
export type ProductListRow = BaseProductListRow & {
  variantGroup?: ProductVariantGroup;
  combinationKey?: string;
  optionValueIds?: string[];
};
export type ProductListResult = Omit<BaseProductListResult, "rows"> & { rows: ProductListRow[] };

export async function getProducts(storeId: string, filters: ProductListFilters = {}): Promise<ProductListResult> {
  const result = await getBaseProducts(storeId, filters);
  if (!result.rows.length) return { ...result, rows: [] };
  const hasRelated = await hasProductRelatedColumn();
  const keys = [...new Set(result.rows.map((row) => row.parentProductId ?? row.relatedProductId ?? row.id))];
  const coordinates = await db.select({
    id: products.id, name: products.name, parentProductId: products.parentProductId,
    relatedProductId: hasRelated ? products.relatedProductId : sql<string | null>`null`,
    isVariantParent: products.isVariantParent,
  }).from(products).where(and(eq(products.storeId, storeId), or(
    inArray(products.id, keys), inArray(products.parentProductId, keys),
    hasRelated ? inArray(products.relatedProductId, keys) : undefined,
  )));
  const available = await db.execute<{ present: boolean }>(sql`select to_regclass('public.product_variant_groups') is not null as present`);
  const storedGroups = available.rows[0]?.present ? (await db.execute<StoredVariantGroup>(sql`select id, kind, attributes, excluded_combination_keys as "excludedCombinationKeys", revision, requires_review as "requiresReview"
    from product_variant_groups where store_id = ${storeId} and ${inArray(sql`id`, keys)}`)).rows : [];
  const groupRoots = coordinates.filter((candidate) => keys.includes(candidate.id) && (candidate.isVariantParent
    || storedGroups.some((group) => group.id === candidate.id)
    || coordinates.some((member) => member.relatedProductId === candidate.id && member.id !== candidate.id)));
  if (!groupRoots.length) return { ...result, rows: result.rows };
  const rootIds = groupRoots.map((root) => root.id);
  const batchIds = coordinates.filter((candidate) => rootIds.includes(candidate.id)
    || rootIds.includes(candidate.parentProductId ?? "") || rootIds.includes(candidate.relatedProductId ?? "")).map((candidate) => candidate.id);
  const [batch, catalogResult] = await Promise.all([
    getBaseProducts(storeId, { status: "all", view: "flat", warehouseId: filters.warehouseId }, { productIds: batchIds, includeDetails: false }),
    db.execute<{ id: string; name: string; aliases: string[] }>(sql`select a.id, a.name,
      coalesce((select json_agg(alias.name_key) from product_attribute_aliases alias where alias.store_id = a.store_id and alias.attribute_id = a.id), '[]'::json) as aliases
      from product_attributes a where a.store_id = ${storeId}`),
  ]);
  let storedMembers: (StoredVariantMember & { groupId: string })[] = [];
  if (available.rows[0]?.present) {
    const members = await db.execute<StoredVariantMember & { groupId: string }>(sql`select group_id as "groupId", product_id as "productId", combination_key as "combinationKey", option_value_ids as "optionValueIds"
        from product_variant_members where store_id = ${storeId} and ${inArray(sql`group_id`, rootIds)}`);
    storedMembers = members.rows;
  }
  const groups = new Map<string, ProductVariantGroup>();
  for (const root of groupRoots) {
    const kind = root.isVariantParent ? "native" : "related";
    const rootRow = batch.rows.find((member) => member.id === root.id);
    const members = batch.rows.filter((member) => !member.isVariantParent && (kind === "native"
      ? member.parentProductId === root.id : member.id === root.id || member.relatedProductId === root.id))
      .map((member) => ({ ...member, description: member.description?.trim() ? member.description : rootRow?.description ?? member.description }));
    if (!members.length) continue;
    groups.set(root.id, projectVariantGroup({ id: root.id, name: root.name, kind, members,
      catalog: catalogResult.rows as VariantCatalogEntry[], stored: storedGroups.find((group) => group.id === root.id),
      identities: storedMembers.filter((member) => member.groupId === root.id) }));
  }
  return { ...result, rows: result.rows.map((row) => {
    const group = groups.get(row.parentProductId ?? row.relatedProductId ?? row.id);
    const identity = group?.members.find((member) => member.id === row.id);
    return { ...row, description: identity?.description ?? row.description, combinationKey: identity?.combinationKey, optionValueIds: identity?.optionValueIds, variantGroup: group };
  }) };
}

export async function getProductListItem(storeId: string, id: string) {
  const result = await getProducts(storeId, {
    exactProductId: id,
    status: "all",
    view: "flat",
    page: 1,
    pageSize: 1,
  });
  return result.rows[0] ?? null;
}

export async function getProduct(storeId: string, id: string) {
  const [product, listRow] = await Promise.all([getBaseProduct(storeId, id), getProductListItem(storeId, id)]);
  if (!product) return null;
  let description = product.description?.trim() ? product.description : listRow?.description ?? product.description;
  if (!description?.trim() && listRow?.variantGroup) {
    const actualRoot = listRow.variantGroup.members.find((member) => member.id === listRow.variantGroup?.id);
    description = actualRoot?.description ?? description;
    if (!description?.trim() && listRow.variantGroup.kind === "native" && listRow.variantGroup.id !== id) {
      description = (await getBaseProduct(storeId, listRow.variantGroup.id))?.description ?? description;
    }
  }
  return { ...product, description, relatedProductId: listRow?.relatedProductId ?? null,
    variantGroup: listRow?.variantGroup, combinationKey: listRow?.combinationKey, optionValueIds: listRow?.optionValueIds };
}
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

export async function getMobileProducts(storeId: string, filters: ProductListFilters = {}) {
  // Keep mobile and web on the same grouped variant projection.
  return getProducts(storeId, {
    ...filters,
    sort: filters.sort ?? DEFAULT_PRODUCT_LIST_SORT,
    view: "grouped",
  });
}

export async function getMobileProductOptions(storeId: string) {
  const [cats, brandRows, supplierRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.storeId, storeId))
      .orderBy(asc(categories.sortOrder), asc(categories.name))
      .limit(80),
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.storeId, storeId))
      .orderBy(asc(brands.name))
      .limit(80),
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.storeId, storeId))
      .orderBy(asc(suppliers.name))
      .limit(80),
  ]);
  return { categories: cats, brands: brandRows, suppliers: supplierRows };
}

/** Chi tiết 1 SP cho trang xem/sửa (gồm đơn vị quy đổi + tồn kho). */
async function getBaseProduct(storeId: string, id: string) {
  const complianceFields = productComplianceFields(
    await hasProductComplianceColumns(),
  );
  const [p] = await db
    .select({
      id: products.id,
      sku: products.sku,
      productKind: products.productKind,
      barcode: products.barcode,
      name: products.name,
      description: products.description,
      categoryId: products.categoryId,
      brandId: products.brandId,
      supplierId: products.supplierId,
      parentProductId: products.parentProductId,
      variantName: products.variantName,
      isVariantParent: products.isVariantParent,
      categoryName: categories.name,
      brandName: brands.name,
      supplierName: suppliers.name,
      baseUnit: products.baseUnit,
      costPrice: products.costPrice,
      retailPrice: products.retailPrice,
      wholesalePrice: products.wholesalePrice,
      contractorPrice: products.contractorPrice,
      agentPrice: products.agentPrice,
      vatRate: complianceFields.vatRate,
      priceByWeight: complianceFields.priceByWeight,
      trackBatches: complianceFields.trackBatches,
      shelfLifeDays: complianceFields.shelfLifeDays,
      lifecycleStatus: complianceFields.lifecycleStatus,
      location: products.location,
      weight: products.weight,
      dimensions: products.dimensions,
      specs: products.specs,
      imageUrls: productCompatibilityImageUrls(storeId),
      imageMediaRecords: productMediaCoordinates(storeId),
      imageUpdatedAt: products.imageUpdatedAt,
      isActive: products.isActive,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      totalStock: sql<string>`case when ${products.isVariantParent} then (
        select coalesce(sum(sl.quantity), 0)
        from products child
        left join stock_levels sl on sl.product_id = child.id
        where child.parent_product_id = ${products.id}
      ) else (
        select coalesce(sum(${stockLevels.quantity}),0) from ${stockLevels} where ${stockLevels.productId} = ${products.id}
      ) end`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(and(eq(products.storeId, storeId), eq(products.id, id)))
    .limit(1);
  if (!p) return null;

  const units = await db
    .select({
      id: productUnits.id,
      unitName: productUnits.unitName,
      multiplier: productUnits.multiplier,
      barcode: productUnits.barcode,
      priceOverride: productUnits.priceOverride,
    })
    .from(productUnits)
    .where(and(eq(productUnits.storeId, storeId), eq(productUnits.productId, id)))
    .orderBy(asc(productUnits.sortOrder));

  const comboItems = await db
    .select({
      productId: productComboItems.componentProductId,
      quantity: productComboItems.quantity,
      name: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
      productKind: products.productKind,
    })
    .from(productComboItems)
    .innerJoin(products, eq(productComboItems.componentProductId, products.id))
    .where(and(eq(productComboItems.storeId, storeId), eq(productComboItems.comboProductId, id)))
    .orderBy(asc(productComboItems.sortOrder));

  // nhiều NCC (chính trước)
  const supplierRows = await db
    .select({
      id: productSuppliers.supplierId,
      name: suppliers.name,
      isPrimary: productSuppliers.isPrimary,
    })
    .from(productSuppliers)
    .leftJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(and(eq(productSuppliers.storeId, storeId), eq(productSuppliers.productId, id)))
    .orderBy(desc(productSuppliers.isPrimary));

  const siblings = p.parentProductId
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          variantName: products.variantName,
          imageUrls: productCompatibilityImageUrls(storeId),
          imageUpdatedAt: products.imageUpdatedAt,
          productKind: products.productKind,
          isActive: products.isActive,
        })
        .from(products)
        .where(
          and(
            eq(products.parentProductId, p.parentProductId),
            eq(products.storeId, storeId),
            sql`${products.id} <> ${id}`,
          ),
        )
        .orderBy(asc(products.name))
    : [];
  const children = p.isVariantParent
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          barcode: products.barcode,
          name: products.name,
          variantName: products.variantName,
          retailPrice: products.retailPrice,
          baseUnit: products.baseUnit,
          totalStock: sql<string>`(select coalesce(sum(${stockLevels.quantity}),0) from ${stockLevels} where ${stockLevels.productId} = ${products.id})`,
          imageUrls: productCompatibilityImageUrls(storeId),
          imageUpdatedAt: products.imageUpdatedAt,
          isActive: products.isActive,
        })
        .from(products)
        .where(and(eq(products.storeId, storeId), eq(products.parentProductId, p.id)))
        .orderBy(asc(products.name))
    : [];

  const childUnits = children.length > 0
    ? await db
        .select({
          id: productUnits.id,
          productId: productUnits.productId,
          unitName: productUnits.unitName,
          multiplier: productUnits.multiplier,
          barcode: productUnits.barcode,
          priceOverride: productUnits.priceOverride,
        })
        .from(productUnits)
        .where(and(
          eq(productUnits.storeId, storeId),
          inArray(productUnits.productId, children.map((child) => child.id)),
        ))
        .orderBy(asc(productUnits.sortOrder))
    : [];
  const childUnitsByProduct = new Map<string, typeof childUnits>();
  for (const unit of childUnits) {
    childUnitsByProduct.set(unit.productId, [
      ...(childUnitsByProduct.get(unit.productId) ?? []),
      unit,
    ]);
  }

  return {
    ...withProductMedia(p),
    units,
    comboItems,
    suppliers: supplierRows,
    siblings,
    children: children.map((child) => ({
      ...child,
      units: childUnitsByProduct.get(child.id) ?? [],
    })),
  };
}


// Danh mục/thương hiệu/NCC cho dropdown — cache 60s (ít thay đổi), dùng chung
// nhiều trang (Sản phẩm, Thiết lập giá, Tồn kho) → đỡ query lặp.
export const getProductFormOptions = unstable_cache(
  async (storeId: string) => {
    const [cats, brandRows, supplierRows, comboProductRows] = await Promise.all([
      db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.storeId, storeId))
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
      db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(eq(brands.storeId, storeId))
        .orderBy(asc(brands.name)),
      db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.storeId, storeId))
        .orderBy(asc(suppliers.name)),
      db
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          baseUnit: products.baseUnit,
          productKind: products.productKind,
          costPrice: products.costPrice,
          retailPrice: products.retailPrice,
          imageUrls: productCompatibilityImageUrls(storeId),
          imageUpdatedAt: products.imageUpdatedAt,
          totalStock: sql<string>`coalesce((
            select sum(${stockLevels.quantity})
            from ${stockLevels}
            where ${stockLevels.productId} = ${products.id}
          ), 0)`,
          isActive: products.isActive,
        })
        .from(products)
        .where(and(
          eq(products.storeId, storeId),
          eq(products.isVariantParent, false),
          sql`${products.productKind} <> 'combo'`,
        ))
        .orderBy(asc(products.name)),
    ]);
    return {
      categories: cats,
      brands: brandRows,
      suppliers: supplierRows,
      comboProducts: comboProductRows,
    };
  },
  ["product-form-options"],
  { revalidate: 60 },
);


export type ProductFormOptions = Awaited<
  ReturnType<typeof getProductFormOptions>
>;

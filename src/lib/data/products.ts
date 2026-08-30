import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
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
  updatedSince?: string;
  page?: number;
  pageSize?: number;
  productSkus?: readonly string[];
  cameraMaterial?: boolean;
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

export async function getProducts(storeId: string, filters: ProductListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize, DEFAULT_PAGE_SIZE);
  const sort = filters.sort ?? "name";
  const status: ProductStatusFilter = filters.status ?? "active";
  const view: ProductListView = filters.view ?? "grouped";
  const [hasComplianceColumns, hasRelatedProducts] = await Promise.all([
    hasProductComplianceColumns(),
    hasProductRelatedColumn(),
  ]);
  const complianceFields = productComplianceFields(hasComplianceColumns);
  const relatedProductIdField = hasRelatedProducts
    ? products.relatedProductId
    : sql<string | null>`null`;
  const conditions: SQL[] = [eq(products.storeId, storeId)];
  const exactProductId = filters.exactProductId;

  if (exactProductId) {
    conditions.push(eq(products.id, exactProductId));
  } else if (filters.q?.trim()) {
    const q = filters.q.trim();
    const childSearch = sql`exists (
      select 1 from products child
      where child.parent_product_id = ${products.id}
        and child.store_id = ${storeId}
        and (
          ${accentInsensitiveLike(sql`child.name`, q)}
          or ${accentInsensitiveLike(sql`child.sku`, q)}
          or ${accentInsensitiveLike(sql`child.barcode`, q)}
        )
    )`;
    const search = or(
      accentInsensitiveLike(products.name, q),
      accentInsensitiveLike(products.sku, q),
      accentInsensitiveLike(products.barcode, q),
      view === "grouped" ? childSearch : undefined,
    );
    if (search) conditions.push(search);
  }
  if (!exactProductId && filters.categoryId) {
    conditions.push(
      view === "grouped"
        ? or(
            eq(products.categoryId, filters.categoryId),
            sql`exists (
              select 1 from products child
              where child.parent_product_id = ${products.id}
                and child.store_id = ${storeId}
                and child.category_id = ${filters.categoryId}
            )`,
          )!
        : eq(products.categoryId, filters.categoryId),
    );
  }
  if (!exactProductId && filters.brandId) conditions.push(eq(products.brandId, filters.brandId));
  if (!exactProductId && filters.supplierId) conditions.push(eq(products.supplierId, filters.supplierId));
  if (!exactProductId && filters.productKind) conditions.push(eq(products.productKind, filters.productKind));
  if (!exactProductId && filters.stock === "instock") conditions.push(sql`${products.totalStock} > 0`);
  if (!exactProductId && filters.stock === "out") conditions.push(sql`${products.totalStock} <= 0`);
  if (!exactProductId && filters.stock === "low") conditions.push(sql`${products.totalStock} > 0 and ${products.totalStock} <= ${products.minStock}`);
  if (!exactProductId && filters.updatedSince) {
    const since = new Date(filters.updatedSince);
    if (!Number.isNaN(since.getTime())) {
      conditions.push(
        view === "grouped"
          ? or(
              gte(products.updatedAt, since),
              sql`exists (
                select 1 from products child
                where child.parent_product_id = ${products.id}
                  and child.store_id = ${storeId}
                  and child.updated_at >= ${since}
              )`,
            )!
          : gte(products.updatedAt, since),
      );
    }
  }
  if (!exactProductId && filters.productSkus?.length && !filters.cameraMaterial) {
    conditions.push(inArray(products.sku, filters.productSkus));
  }
  if (!exactProductId && filters.cameraMaterial) {
    conditions.push(
      or(
        filters.productSkus?.length ? inArray(products.sku, filters.productSkus) : undefined,
        sql`${products.specs}->>'__cameraQuoteMaterial' = 'true'`,
      )!,
    );
  }
  if (exactProductId) {
    // An exact lookup must find both variant parents and children regardless of
    // the list's current status/view filters.
  } else if (view === "grouped") {
    conditions.push(sql`${products.parentProductId} is null`);
    if (status === "active") {
      conditions.push(
        or(
          eq(products.isActive, true),
          sql`exists (
          select 1 from products child
          where child.parent_product_id = ${products.id}
            and child.store_id = ${storeId}
            and child.is_active = true
        )`,
        )!,
      );
    } else if (status === "inactive") {
      conditions.push(
        and(
          eq(products.isActive, false),
          sql`not exists (
          select 1 from products child
          where child.parent_product_id = ${products.id}
            and child.store_id = ${storeId}
            and child.is_active = true
        )`,
        )!,
      );
    } else if (hasComplianceColumns && (status === "draft" || status === "archived")) {
      conditions.push(
        or(
          eq(products.lifecycleStatus, status),
          sql`exists (
            select 1 from products child
            where child.parent_product_id = ${products.id}
              and child.store_id = ${storeId}
              and child.lifecycle_status = ${status}
          )`,
        )!,
      );
    }
  } else {
    conditions.push(eq(products.isVariantParent, false));
    if (status === "active") conditions.push(eq(products.isActive, true));
    else if (status === "inactive")
      conditions.push(eq(products.isActive, false));
    else if (hasComplianceColumns && (status === "draft" || status === "archived"))
      conditions.push(eq(products.lifecycleStatus, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
      .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
      .where(where)
      .groupBy(products.id, categories.name, brands.name)
      .orderBy(
        sort === "stock"
          ? desc(products.totalStock)
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
          .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
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
    physicalProductIds.length > 0
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
    physicalProductIds.length > 0
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

  const relatedLookup = buildRelatedProductLookup(hasRelatedProducts, rows);
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
        .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
        .where(and(eq(products.storeId, storeId), relatedWhere))
        .groupBy(products.id)
        .orderBy(asc(products.sku))
        .limit(240)
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
export async function getProduct(storeId: string, id: string) {
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
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

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

export type ProductListResult = Awaited<ReturnType<typeof getProducts>>;
export type ProductFormOptions = Awaited<
  ReturnType<typeof getProductFormOptions>
>;

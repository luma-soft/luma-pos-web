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
  productUnits,
  productSuppliers,
  stockLevels,
  stockMovements,
  suppliers,
  warehouses,
} from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";
import { coercePageSize, DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export const PRODUCTS_PAGE_SIZE = 20;

/** active = chỉ đang bán (mặc định), inactive = ngừng bán, all = tất cả. */
export type ProductStatusFilter = "active" | "inactive" | "all";
export type ProductListView = "grouped" | "flat";

export interface ProductListFilters {
  q?: string;
  categoryId?: string;
  status?: ProductStatusFilter;
  view?: ProductListView;
  page?: number;
  pageSize?: number;
}

export const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

export async function getProducts(filters: ProductListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize, DEFAULT_PAGE_SIZE);
  const status: ProductStatusFilter = filters.status ?? "active";
  const view: ProductListView = filters.view ?? "grouped";
  const conditions: SQL[] = [];

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const childSearch = sql`exists (
      select 1 from products child
      where child.parent_product_id = ${products.id}
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
  if (filters.categoryId) {
    conditions.push(
      view === "grouped"
        ? or(
            eq(products.categoryId, filters.categoryId),
            sql`exists (
              select 1 from products child
              where child.parent_product_id = ${products.id}
                and child.category_id = ${filters.categoryId}
            )`,
          )!
        : eq(products.categoryId, filters.categoryId),
    );
  }
  if (view === "grouped") {
    conditions.push(sql`${products.parentProductId} is null`);
    if (status === "active") {
      conditions.push(
        or(
          eq(products.isActive, true),
          sql`exists (
          select 1 from products child
          where child.parent_product_id = ${products.id}
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
            and child.is_active = true
        )`,
        )!,
      );
    }
  } else {
    conditions.push(eq(products.isVariantParent, false));
    if (status === "active") conditions.push(eq(products.isActive, true));
    else if (status === "inactive")
      conditions.push(eq(products.isActive, false));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
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
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        isActive: products.isActive,
        createdAt: products.createdAt,
        categoryName: categories.name,
        brandName: brands.name,
        location: products.location,
        weight: products.weight,
        dimensions: products.dimensions,
        specs: products.specs,
        imageUrls: products.imageUrls,
        childCount: sql<number>`(
          select count(*)::int from products child where child.parent_product_id = ${products.id}
        )`,
        minCostPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select min(child.cost_price) from products child where child.parent_product_id = ${products.id}
        ), ${products.costPrice}) else ${products.costPrice} end`,
        maxCostPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select max(child.cost_price) from products child where child.parent_product_id = ${products.id}
        ), ${products.costPrice}) else ${products.costPrice} end`,
        minRetailPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select min(child.retail_price) from products child where child.parent_product_id = ${products.id}
        ), ${products.retailPrice}) else ${products.retailPrice} end`,
        maxRetailPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
          select max(child.retail_price) from products child where child.parent_product_id = ${products.id}
        ), ${products.retailPrice}) else ${products.retailPrice} end`,
        totalStock: sql<string>`case when ${products.isVariantParent} then (
          select coalesce(sum(sl.quantity), 0)
          from products child
          left join stock_levels sl on sl.product_id = child.id
          where child.parent_product_id = ${products.id}
        ) else coalesce(sum(${stockLevels.quantity}), 0) end`,
        reservedStock: sql<string>`case when ${products.isVariantParent} then (
          select coalesce(sum(sl.reserved), 0)
          from products child
          left join stock_levels sl on sl.product_id = child.id
          where child.parent_product_id = ${products.id}
        ) else coalesce(sum(${stockLevels.reserved}), 0) end`,
        minLevel: sql<string>`case when ${products.isVariantParent} then (
          select coalesce(max(sl.min_level), 0)
          from products child
          left join stock_levels sl on sl.product_id = child.id
          where child.parent_product_id = ${products.id}
        ) else coalesce(max(${stockLevels.minLevel}), 0) end`,
        unitNames: sql<string | null>`(
          select string_agg(${productUnits.unitName}, ', ' order by ${productUnits.sortOrder})
          from ${productUnits} where ${productUnits.productId} = ${products.id}
        )`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
      .where(where)
      .groupBy(products.id, categories.name, brands.name)
      .orderBy(desc(products.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(products).where(where),
  ]);

  const parentIds =
    view === "grouped"
      ? rows.filter((row) => row.isVariantParent).map((row) => row.id)
      : [];
  const children =
    parentIds.length > 0
      ? await db
          .select({
            id: products.id,
            sku: products.sku,
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
            parentProductId: products.parentProductId,
            variantName: products.variantName,
            isVariantParent: products.isVariantParent,
            isActive: products.isActive,
            createdAt: products.createdAt,
            categoryName: categories.name,
            brandName: brands.name,
            location: products.location,
            weight: products.weight,
            dimensions: products.dimensions,
            specs: products.specs,
            imageUrls: products.imageUrls,
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
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .leftJoin(brands, eq(products.brandId, brands.id))
          .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
          .where(inArray(products.parentProductId, parentIds))
          .groupBy(products.id, categories.name, brands.name)
          .orderBy(asc(products.name))
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
          .where(inArray(stockLevels.productId, physicalProductIds))
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
          .where(inArray(stockMovements.productId, physicalProductIds))
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

  const parentKeys = [
    ...new Set(
      rows
        .map(
          (row) => row.parentProductId ?? (row.isVariantParent ? row.id : null),
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const categoryIds = [
    ...new Set(
      rows
        .map((row) => row.categoryId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const relatedWhere = or(
    parentKeys.length > 0
      ? inArray(products.parentProductId, parentKeys)
      : undefined,
    categoryIds.length > 0
      ? inArray(products.categoryId, categoryIds)
      : undefined,
  );
  const relatedCandidates = relatedWhere
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          categoryId: products.categoryId,
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
        .where(relatedWhere)
        .groupBy(products.id)
        .orderBy(asc(products.name))
        .limit(240)
    : [];

  return {
    rows: rows.map((row) => {
      const parentKey =
        row.parentProductId ?? (row.isVariantParent ? row.id : null);
      const relatedProducts = relatedCandidates
        .filter((candidate) => {
          if (candidate.id === row.id) return false;
          if (parentKey) return candidate.parentProductId === parentKey;
          return Boolean(
            row.categoryId && candidate.categoryId === row.categoryId,
          );
        })
        .slice(0, 12);
      return {
        ...row,
        children: childrenByParent.get(row.id) ?? [],
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

export async function getMobileProducts(filters: ProductListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const size = coercePageSize(filters.pageSize, 15);
  const status: ProductStatusFilter = filters.status ?? "active";
  const conditions: SQL[] = [sql`${products.parentProductId} is null`];

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    const search = or(
      accentInsensitiveLike(products.name, q),
      accentInsensitiveLike(products.sku, q),
      accentInsensitiveLike(products.barcode, q),
    );
    if (search) conditions.push(search);
  }
  if (filters.categoryId) {
    conditions.push(eq(products.categoryId, filters.categoryId));
  }
  if (status === "active") {
    conditions.push(eq(products.isActive, true));
  } else if (status === "inactive") {
    conditions.push(eq(products.isActive, false));
  }

  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        description: products.description,
        categoryId: products.categoryId,
        brandId: products.brandId,
        supplierId: products.supplierId,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        retailPrice: products.retailPrice,
        wholesalePrice: products.wholesalePrice,
        contractorPrice: products.contractorPrice,
        agentPrice: products.agentPrice,
        parentProductId: products.parentProductId,
        variantName: products.variantName,
        isVariantParent: products.isVariantParent,
        isActive: products.isActive,
        categoryName: categories.name,
        brandName: brands.name,
        supplierName: suppliers.name,
        totalStock: products.totalStock,
        minLevel: products.minStock,
        childCount: sql<number>`(
          select count(*)::int from products child where child.parent_product_id = ${products.id}
        )`,
        minRetailPrice: products.retailPrice,
        maxRetailPrice: products.retailPrice,
        units: sql<
          { unitName: string; multiplier: string; barcode: string | null }[]
        >`coalesce((
          select json_agg(json_build_object('unitName', pu.unit_name, 'multiplier', pu.multiplier, 'barcode', pu.barcode) order by pu.sort_order)
          from product_units pu where pu.product_id = ${products.id}
        ), '[]')`,
        children: sql<unknown[]>`'[]'::json`,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(where)
      .orderBy(asc(products.name))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(products).where(where),
  ]);

  return {
    rows,
    total,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(total / size)),
  };
}

/** Chi tiết 1 SP cho trang xem/sửa (gồm đơn vị quy đổi + tồn kho). */
export async function getProduct(id: string) {
  const [p] = await db
    .select({
      id: products.id,
      sku: products.sku,
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
      location: products.location,
      weight: products.weight,
      specs: products.specs,
      imageUrls: products.imageUrls,
      isActive: products.isActive,
      createdAt: products.createdAt,
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
    .where(eq(products.id, id))
    .limit(1);
  if (!p) return null;

  const units = await db
    .select({
      unitName: productUnits.unitName,
      multiplier: productUnits.multiplier,
      barcode: productUnits.barcode,
      priceOverride: productUnits.priceOverride,
    })
    .from(productUnits)
    .where(eq(productUnits.productId, id))
    .orderBy(asc(productUnits.sortOrder));

  // nhiều NCC (chính trước)
  const supplierRows = await db
    .select({
      id: productSuppliers.supplierId,
      name: suppliers.name,
      isPrimary: productSuppliers.isPrimary,
    })
    .from(productSuppliers)
    .leftJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(eq(productSuppliers.productId, id))
    .orderBy(desc(productSuppliers.isPrimary));

  const siblings = p.parentProductId
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          variantName: products.variantName,
          imageUrls: products.imageUrls,
          isActive: products.isActive,
        })
        .from(products)
        .where(
          and(
            eq(products.parentProductId, p.parentProductId),
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
          imageUrls: products.imageUrls,
          isActive: products.isActive,
        })
        .from(products)
        .where(eq(products.parentProductId, p.id))
        .orderBy(asc(products.name))
    : [];

  return { ...p, units, suppliers: supplierRows, siblings, children };
}
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

// Danh mục/thương hiệu/NCC cho dropdown — cache 60s (ít thay đổi), dùng chung
// nhiều trang (Sản phẩm, Thiết lập giá, Tồn kho) → đỡ query lặp.
export const getProductFormOptions = unstable_cache(
  async () => {
    const [cats, brandRows, supplierRows] = await Promise.all([
      db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
      db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .orderBy(asc(brands.name)),
      db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .orderBy(asc(suppliers.name)),
    ]);
    return { categories: cats, brands: brandRows, suppliers: supplierRows };
  },
  ["product-form-options"],
  { revalidate: 60 },
);

export type ProductListResult = Awaited<ReturnType<typeof getProducts>>;
export type ProductFormOptions = Awaited<
  ReturnType<typeof getProductFormOptions>
>;

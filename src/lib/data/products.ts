import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { brands, categories, products, productUnits, productSuppliers, stockLevels, suppliers } from "@/db/schema";
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
      view === "grouped" ? childSearch : undefined
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
            )`
          )!
        : eq(products.categoryId, filters.categoryId)
    );
  }
  if (view === "grouped") {
    conditions.push(sql`${products.parentProductId} is null`);
    if (status === "active") {
      conditions.push(or(
        eq(products.isActive, true),
        sql`exists (
          select 1 from products child
          where child.parent_product_id = ${products.id}
            and child.is_active = true
        )`
      )!);
    } else if (status === "inactive") {
      conditions.push(and(
        eq(products.isActive, false),
        sql`not exists (
          select 1 from products child
          where child.parent_product_id = ${products.id}
            and child.is_active = true
        )`
      )!);
    }
  } else {
    conditions.push(eq(products.isVariantParent, false));
    if (status === "active") conditions.push(eq(products.isActive, true));
    else if (status === "inactive") conditions.push(eq(products.isActive, false));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
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
        childCount: sql<number>`(
          select count(*)::int from products child where child.parent_product_id = ${products.id}
        )`,
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
      .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
      .where(where)
      .groupBy(products.id, categories.name)
      .orderBy(desc(products.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(products).where(where),
  ]);

  const parentIds = view === "grouped" ? rows.filter((row) => row.isVariantParent).map((row) => row.id) : [];
  const children = parentIds.length > 0
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
          barcode: products.barcode,
          name: products.name,
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
          childCount: sql<number>`0`,
          minRetailPrice: products.retailPrice,
          maxRetailPrice: products.retailPrice,
          totalStock: sql<string>`coalesce(sum(${stockLevels.quantity}), 0)`,
          minLevel: sql<string>`coalesce(max(${stockLevels.minLevel}), 0)`,
          unitNames: sql<string | null>`(
            select string_agg(${productUnits.unitName}, ', ' order by ${productUnits.sortOrder})
            from ${productUnits} where ${productUnits.productId} = ${products.id}
          )`,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
        .where(inArray(products.parentProductId, parentIds))
        .groupBy(products.id, categories.name)
        .orderBy(asc(products.name))
    : [];

  const childrenByParent = new Map<string, typeof children>();
  for (const child of children) {
    if (!child.parentProductId) continue;
    const group = childrenByParent.get(child.parentProductId) ?? [];
    group.push(child);
    childrenByParent.set(child.parentProductId, group);
  }

  return {
    rows: rows.map((row) => ({ ...row, children: childrenByParent.get(row.id) ?? [] })),
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
    .select({ id: productSuppliers.supplierId, name: suppliers.name, isPrimary: productSuppliers.isPrimary })
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
        .where(and(eq(products.parentProductId, p.parentProductId), sql`${products.id} <> ${id}`))
        .orderBy(asc(products.name))
    : [];
  const children = p.isVariantParent
    ? await db
        .select({
          id: products.id,
          sku: products.sku,
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
      db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
      db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
      db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    ]);
    return { categories: cats, brands: brandRows, suppliers: supplierRows };
  },
  ["product-form-options"],
  { revalidate: 60 }
);

export type ProductListResult = Awaited<ReturnType<typeof getProducts>>;
export type ProductFormOptions = Awaited<ReturnType<typeof getProductFormOptions>>;

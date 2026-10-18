import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { lastPurchaseNetPriceSql } from "@/lib/pricing/last-purchase-net-price";
import { categories, customers, orderItems, orders, paymentBankAccounts, products, productComboItems, productPrices, productUnits, projects, stockLevels, warehouses } from "@/db/schema";
import { getActivePromotions } from "@/lib/data/active-promotions";
import { getPriceBooks } from "@/lib/data/price-books";
import type { Role } from "@/lib/actions/common";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";
import { catalogProductSearchCondition } from "@/lib/search";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";
import { applySystemPriceBooks } from "@/lib/pos/system-price-projection";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { priceComparisonCondition, type PriceComparison } from "@/lib/pricing/price-comparison";
import { getRawStorePrefs } from "@/lib/data/settings";
import { lastCompletedProductSaleAt, recentProductSaleOrder } from "@/lib/data/recent-product-sales";

export interface PosUnit {
  unitName: string;
  multiplier: string;
  sku: string | null;
  barcode: string | null;
  priceOverride: string | null;
  directSale: boolean;
}

function sellableUnitCondition() {
  return sql`(
    ${products.baseUnitDirectSale} = true
    or exists (
      select 1 from product_units sellable_unit
      where sellable_unit.product_id = ${products.id}
        and sellable_unit.direct_sale = true
    )
  )`;
}

function sortByRecentSale<T extends { lastSoldAt: Date | string | null; name: string }>(
  rows: T[],
): T[] {
  return rows.sort((a, b) => {
    const aTime = a.lastSoldAt == null ? 0 : new Date(a.lastSoldAt).getTime();
    const bTime = b.lastSoldAt == null ? 0 : new Date(b.lastSoldAt).getTime();
    return bTime - aTime || a.name.localeCompare(b.name, "vi");
  });
}

/** Select dùng chung cho lưới POS + tìm kiếm (cùng shape PosProduct). */
function posProductSelect(
  storeId: string,
  warehouseId: string | null,
  hasComplianceColumns: boolean,
) {
  return {
    id: products.id,
    sku: products.sku,
    barcode: products.barcode,
    name: products.name,
    productKind: products.productKind,
    imageUrls: productCompatibilityImageUrls(storeId),
    imageUpdatedAt: products.imageUpdatedAt,
    specs: products.specs,
    parentProductId: products.parentProductId,
    variantName: products.variantName,
    isVariantParent: products.isVariantParent,
    baseUnit: products.baseUnit,
    baseUnitDirectSale: products.baseUnitDirectSale,
    // Chỉ dùng nội bộ để gắn vào bảng giá vốn cho owner/manager bên dưới.
    // Không trả trực tiếp trường này ra client.
    costPrice: products.costPrice,
    lastPurchasePrice: products.lastPurchasePrice,
    lastPurchaseNetPrice: lastPurchaseNetPriceSql(storeId),
    retailPrice: products.retailPrice,
    wholesalePrice: products.wholesalePrice,
    contractorPrice: products.contractorPrice,
    agentPrice: products.agentPrice,
    priceByWeight: hasComplianceColumns ? products.priceByWeight : sql<boolean>`false`,
    m2PerUnit: products.m2PerUnit,
    categoryId: products.categoryId,
    categoryName: categories.name,
    vatRate: hasComplianceColumns ? products.vatRate : sql<string | null>`null`,
    lastSoldAt: lastCompletedProductSaleAt(),
    comboItems: sql<Array<{ productId: string; quantity: string }>>`coalesce((
      select json_agg(json_build_object(
        'productId', ${productComboItems.componentProductId},
        'quantity', ${productComboItems.quantity}
      ) order by ${productComboItems.sortOrder})
      from ${productComboItems}
      where ${productComboItems.comboProductId} = ${products.id}
    ), '[]')`,
    childCount: sql<number>`(
      select count(*)::int from products child where child.parent_product_id = ${products.id}
    )`,
    minRetailPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
      select min(child.retail_price) from products child where child.parent_product_id = ${products.id}
    ), ${products.retailPrice}) else ${products.retailPrice} end`,
    maxRetailPrice: sql<string>`case when ${products.isVariantParent} then coalesce((
      select max(child.retail_price) from products child where child.parent_product_id = ${products.id}
    ), ${products.retailPrice}) else ${products.retailPrice} end`,
    stock: sql<string>`case when ${products.isVariantParent} then (
      select coalesce(sum(sl.quantity), 0)
      from products child
      left join stock_levels sl on sl.product_id = child.id
      where child.parent_product_id = ${products.id}
    ) else coalesce((
      select ${stockLevels.quantity} from ${stockLevels}
      where ${stockLevels.productId} = ${products.id}
        and ${stockLevels.warehouseId} = ${warehouseId ?? sql`null`}
    ), 0) end`,
    // Tổng số lượng của các phiếu đặt hàng còn hiệu lực tại kho POS.
    booked: sql<string>`case when ${products.isVariantParent} then (
      select coalesce(sum(${orderItems.quantity} * ${orderItems.unitMultiplier}), 0)
      from ${orderItems}
      inner join ${orders} on ${orders.id} = ${orderItems.orderId}
      inner join products child on child.id = ${orderItems.productId}
      where child.parent_product_id = ${products.id}
        and ${orders.status} = 'confirmed'
        and ${orders.warehouseId} = ${warehouseId ?? sql`null`}
    ) else coalesce((
      select sum(${orderItems.quantity} * ${orderItems.unitMultiplier})
      from ${orderItems}
      inner join ${orders} on ${orders.id} = ${orderItems.orderId}
      where ${orderItems.productId} = ${products.id}
        and ${orders.status} = 'confirmed'
        and ${orders.warehouseId} = ${warehouseId ?? sql`null`}
    ), 0) end`,
    units: sql<PosUnit[]>`coalesce((
      select json_agg(json_build_object(
        'unitName', ${productUnits.unitName},
        'multiplier', ${productUnits.multiplier},
        'sku', ${productUnits.sku},
        'barcode', ${productUnits.barcode},
        'priceOverride', ${productUnits.priceOverride},
        'directSale', ${productUnits.directSale}
      ) order by ${productUnits.sortOrder})
      from ${productUnits} where ${productUnits.productId} = ${products.id}
    ), '[]')`,
    // override giá theo bảng giá: { [priceBookId]: price }
    prices: sql<Record<string, string | null>>`coalesce((
      select json_object_agg(${productPrices.priceBookId}, ${productPrices.price})
      from ${productPrices} where ${productPrices.productId} = ${products.id}
    ), '{}')`,
    children: sql<unknown[]>`'[]'::json`,
  };
}

function attachChildren<
  T extends { id: string; isVariantParent: boolean; children: unknown[] },
  C extends T & { parentProductId: string | null }
>(roots: T[], children: C[]): T[] {
  const byParent = new Map<string, C[]>();
  for (const child of children) {
    if (!child.parentProductId) continue;
    const group = byParent.get(child.parentProductId) ?? [];
    group.push({ ...child, children: [] });
    byParent.set(child.parentProductId, group);
  }
  return roots.map((root) => ({
    ...root,
    children: root.isVariantParent ? byParent.get(root.id) ?? [] : [],
  }));
}

function activeRootCondition(storeId: string) {
  return and(
    eq(products.storeId, storeId),
    sql`${products.parentProductId} is null`,
    or(
      and(eq(products.isActive, true), sellableUnitCondition()),
      sql`exists (
        select 1 from products child
        where child.parent_product_id = ${products.id}
          and child.is_active = true
          and (
            child.base_unit_direct_sale = true
            or exists (
              select 1 from product_units child_unit
              where child_unit.product_id = child.id
                and child_unit.direct_sale = true
            )
          )
      )`
    )
  );
}

/** Toàn bộ data POS cần khi mở trang: SP active + đơn vị + tồn kho mặc định, KH, kho. */
export async function getPosData(storeId: string, options?: {
  includeProductIds?: readonly string[];
  includeProductSkus?: readonly string[];
  includeProductCategories?: readonly string[];
  role?: Role;
  sort?: "recent_sales" | "created";
}) {
  const hasComplianceColumns = await hasProductComplianceColumns();
  const [defaultWh] = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.storeId, storeId))
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const includeProductIds = [...new Set(options?.includeProductIds ?? [])];
  const includeProductSkus = [...new Set(options?.includeProductSkus ?? [])];
  const includeProductCategories = [...new Set(options?.includeProductCategories ?? [])];
  const [rootRows, sourceProductRows, customerRows] = await Promise.all([
    db
      .select(posProductSelect(storeId, defaultWh?.id ?? null, hasComplianceColumns))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(activeRootCondition(storeId))
      .orderBy(...(options?.sort === "created"
        ? [desc(products.createdAt), desc(products.id)] as const
        : recentProductSaleOrder()))
      .limit(200),
    includeProductIds.length || includeProductSkus.length || includeProductCategories.length
      ? db
          .select(posProductSelect(storeId, defaultWh?.id ?? null, hasComplianceColumns))
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(
            eq(products.storeId, storeId),
            eq(products.isActive, true),
            or(
              includeProductIds.length ? inArray(products.id, includeProductIds) : undefined,
              includeProductSkus.length ? inArray(products.sku, includeProductSkus) : undefined,
              includeProductCategories.length ? inArray(categories.name, includeProductCategories) : undefined,
            ),
          ))
      : Promise.resolve([]),
    db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        type: customers.type,
        currentDebt: customers.currentDebt,
        debtLimit: customers.debtLimit,
      })
      .from(customers)
      .where(and(eq(customers.storeId, storeId), eq(customers.isActive, true)))
      .orderBy(asc(customers.name))
      .limit(500),
  ]);

  const parentIds = rootRows.filter((p) => p.isVariantParent).map((p) => p.id);
  const childRows = parentIds.length > 0
    ? await db
        .select(posProductSelect(storeId, defaultWh?.id ?? null, hasComplianceColumns))
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(
          eq(products.storeId, storeId),
          eq(products.isActive, true),
          sellableUnitCondition(),
          inArray(products.parentProductId, parentIds),
        ))
        .orderBy(...recentProductSaleOrder())
    : [];

  const productRows = attachChildren(rootRows, childRows);
  const byId = new Map(productRows.map((p) => [p.id, p]));
  for (const p of sourceProductRows) byId.set(p.id, p);
  const productsForPos = [...byId.values()];

  const priceBookRows = await getPriceBooks(storeId, {
    includeManagerOnly: canViewPurchasePrices(options?.role),
  });

  const [promoByProduct, projectRows, defaultBankAccount] = await Promise.all([
    getActivePromotions(storeId),
    db
      .select({ id: projects.id, name: projects.name, customerId: projects.customerId })
      .from(projects)
      .where(eq(projects.status, "active"))
      .orderBy(asc(projects.name))
      .limit(300),
    db
      .select({
        id: paymentBankAccounts.id,
        bankCode: paymentBankAccounts.bankCode,
        gateway: paymentBankAccounts.gateway,
        accountNumber: paymentBankAccounts.accountNumber,
        subAccount: paymentBankAccounts.subAccount,
        accountName: paymentBankAccounts.accountName,
      })
      .from(paymentBankAccounts)
      .where(and(
        eq(paymentBankAccounts.storeId, storeId),
        eq(paymentBankAccounts.provider, "sepay"),
        eq(paymentBankAccounts.enabled, true),
      ))
      .orderBy(sql`${paymentBankAccounts.isDefault} desc`, asc(paymentBankAccounts.createdAt))
      .limit(1),
  ]);

  applySystemPriceBooks(productsForPos as Parameters<typeof applySystemPriceBooks>[0], priceBookRows);

  return {
    warehouse: defaultWh ?? null,
    products: productsForPos,
    customers: customerRows,
    promoByProduct,
    projects: projectRows,
    priceBooks: priceBookRows,
    defaultBankAccount: defaultBankAccount[0] ?? null,
  };
}

export async function getMobilePosData(
  storeId: string,
  role: Role,
  options?: { includeProductIds?: readonly string[] },
) {
  // Reuse the POS dataset so mobile gets the same POS projection,
  // manager-only price books, stock reservations, and product image data.
  const includeProductIds = [...new Set(options?.includeProductIds ?? [])]
    .map((id) => id.trim())
    .filter(Boolean);
  const [data, prefs] = await Promise.all([
    getPosData(storeId, {
      role,
      sort: "recent_sales",
      includeProductIds,
    }),
    getRawStorePrefs(storeId),
  ]);
  const products = data.products.slice(0, 30);
  const seenProductIds = new Set(products.map((product) => product.id));
  for (const product of data.products) {
    if (!includeProductIds.includes(product.id) || seenProductIds.has(product.id)) {
      continue;
    }
    products.push(product);
    seenProductIds.add(product.id);
  }
  return {
    ...data,
    products,
    customers: data.customers.slice(0, 100),
    projects: data.projects.slice(0, 100),
    taxPrefs: prefs.tax,
  };
}

/**
 * Tìm SP cho POS phía server (không phân biệt hoa/thường, không dấu) — quét
 * toàn bộ SP active để khớp đúng kết quả như trang Sản phẩm, không bị giới hạn
 * 200 SP của lưới mặc định.
 */
export async function searchPosProductRows(
  storeId: string,
  q: string,
  options?: {
    role?: Role;
    priceComparison?: PriceComparison;
    categoryNames?: string[];
    stock?: "all" | "available" | "outOfStock";
    productKind?: "all" | "product" | "service" | "combo";
  },
): Promise<PosProduct[]> {
  const hasComplianceColumns = await hasProductComplianceColumns();
  const [defaultWh] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.storeId, storeId))
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const match: SQL | undefined = catalogProductSearchCondition(products, q);
  const canCompareSellingPrice = canViewPurchasePrices(options?.role);
  const visibleBooks = await getPriceBooks(storeId, {
    includeManagerOnly: canCompareSellingPrice,
  });
  const requestedBookId = options?.priceComparison?.priceBookId;
  const comparison: PriceComparison = canCompareSellingPrice
    ? {
        ...options?.priceComparison,
        priceBookId: visibleBooks.some((book) => book.id === requestedBookId)
          ? requestedBookId
          : undefined,
      }
    : {};
  const pricePredicate = priceComparisonCondition(storeId, comparison, {
    id: products.id,
    retailPrice: products.retailPrice,
    costPrice: products.costPrice,
  });
  const categoryPredicate = options?.categoryNames?.length
    ? inArray(categories.name, options.categoryNames)
    : undefined;
  const kindPredicate = options?.productKind && options.productKind !== "all"
    ? eq(products.productKind, options.productKind)
    : undefined;
  const stockQuantity = sql`coalesce((select sum(pos_filter_stock.quantity)
    from stock_levels pos_filter_stock
    where pos_filter_stock.store_id = ${storeId}
      and pos_filter_stock.product_id = ${products.id}
      and pos_filter_stock.warehouse_id = ${defaultWh?.id ?? ""}), 0)`;
  const stockPredicate = options?.stock === "available"
    ? sql`${stockQuantity} > 0`
    : options?.stock === "outOfStock"
      ? sql`${stockQuantity} <= 0`
      : undefined;
  const directFilters = and(categoryPredicate, kindPredicate, stockPredicate, pricePredicate);
  const variantMemberFilters = (alias: string) => {
    const id = sql.raw(`"${alias}"."id"`);
    const categoryId = sql.raw(`"${alias}"."category_id"`);
    const productKind = sql.raw(`"${alias}"."product_kind"`);
    const retailPrice = sql.raw(`"${alias}"."retail_price"`);
    const costPrice = sql.raw(`"${alias}"."cost_price"`);
    const quantity = sql`coalesce((select sum(pos_member_stock.quantity)
      from stock_levels pos_member_stock
      where pos_member_stock.store_id = ${storeId}
        and pos_member_stock.product_id = ${id}
        and pos_member_stock.warehouse_id = ${defaultWh?.id ?? ""}), 0)`;
    return and(
      categoryPredicate ? sql`${categoryId} in (select id from categories where name in (${sql.join(options!.categoryNames!.map((name) => sql`${name}`), sql`, `)}))` : undefined,
      kindPredicate ? sql`${productKind} = ${options?.productKind}` : undefined,
      options?.stock === "available" ? sql`${quantity} > 0` : undefined,
      options?.stock === "outOfStock" ? sql`${quantity} <= 0` : undefined,
      priceComparisonCondition(storeId, comparison, { id, retailPrice, costPrice }),
    );
  };

  const [childRows, rootRows] = await Promise.all([
    db
      .select(posProductSelect(storeId, defaultWh?.id ?? null, hasComplianceColumns))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        eq(products.storeId, storeId),
        eq(products.isActive, true),
        eq(products.isVariantParent, false),
        sellableUnitCondition(),
        match,
        directFilters,
      ))
      .orderBy(...recentProductSaleOrder()),
    db
      .select(posProductSelect(storeId, defaultWh?.id ?? null, hasComplianceColumns))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        activeRootCondition(storeId),
        match,
        or(
          and(eq(products.isVariantParent, false), directFilters),
          and(
            eq(products.isVariantParent, true),
            sql`exists (
              select 1 from products pos_filter_member
              left join categories pos_filter_category on pos_filter_category.id = pos_filter_member.category_id
              where pos_filter_member.store_id = ${storeId}
                and pos_filter_member.parent_product_id = ${products.id}
                and pos_filter_member.is_active = true
                and (
                  pos_filter_member.base_unit_direct_sale = true
                  or exists (
                    select 1 from product_units pos_filter_unit
                    where pos_filter_unit.product_id = pos_filter_member.id
                      and pos_filter_unit.direct_sale = true
                  )
                )
                ${variantMemberFilters("pos_filter_member") ? sql`and ${variantMemberFilters("pos_filter_member")}` : sql``}
            )`,
          ),
        ),
      ))
      .orderBy(...recentProductSaleOrder()),
  ]);

  const parentIds = rootRows.filter((p) => p.isVariantParent).map((p) => p.id);
  const pickerChildren = parentIds.length > 0
    ? await db
        .select(posProductSelect(storeId, defaultWh?.id ?? null, hasComplianceColumns))
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(
          eq(products.storeId, storeId),
          eq(products.isActive, true),
          sellableUnitCondition(),
          inArray(products.parentProductId, parentIds),
          directFilters,
        ))
      .orderBy(...recentProductSaleOrder())
    : [];

  const rootsWithChildren = attachChildren(rootRows, pickerChildren);
  const seen = new Set<string>();
  const rows = sortByRecentSale([...childRows.map((p) => ({ ...p, children: [] })), ...rootsWithChildren].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }));
  // Kết quả tìm kiếm phải có cùng map bảng giá và quyền đọc giá vốn như lưới POS.
  applySystemPriceBooks(rows as Parameters<typeof applySystemPriceBooks>[0], visibleBooks);
  return rows;
}

export type PosData = Awaited<ReturnType<typeof getPosData>>;
export type PosProduct = PosData["products"][number] & { priceBookTypes?: Record<string, "retail" | "cost" | "purchase" | "list" | null> };
export type PosCustomer = PosData["customers"][number];

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, customers, orderItems, orders, paymentBankAccounts, products, productComboItems, productPrices, productUnits, projects, promotions, stockLevels, warehouses } from "@/db/schema";
import { isPromoActive, type PromoTier } from "@/lib/promo";
import { getPriceBooks } from "@/lib/data/price-books";
import type { Role } from "@/lib/actions/common";
import { hasProductComplianceColumns } from "@/lib/db/schema-compat";
import { accentInsensitiveLike } from "@/lib/search";

export interface PosUnit {
  unitName: string;
  multiplier: string;
  priceOverride: string | null;
}

/** Lần bán hoàn tất gần nhất; biến thể cha kế thừa lần bán mới nhất của SKU con. */
function lastCompletedSaleAt() {
  return sql<Date | null>`case when ${products.isVariantParent} then (
    select max(${orders.createdAt})
    from ${orderItems}
    inner join ${orders} on ${orders.id} = ${orderItems.orderId}
    inner join products child on child.id = ${orderItems.productId}
    where child.parent_product_id = ${products.id}
      and ${orders.status} = 'completed'
  ) else (
    select max(${orders.createdAt})
    from ${orderItems}
    inner join ${orders} on ${orders.id} = ${orderItems.orderId}
    where ${orderItems.productId} = ${products.id}
      and ${orders.status} = 'completed'
  ) end`;
}

function recentSaleOrder() {
  return [sql`${lastCompletedSaleAt()} desc nulls last`, asc(products.name)] as const;
}

/** Select dùng chung cho lưới POS + tìm kiếm (cùng shape PosProduct). */
function posProductSelect(warehouseId: string | null, hasComplianceColumns: boolean) {
  return {
    id: products.id,
    sku: products.sku,
    barcode: products.barcode,
    name: products.name,
    productKind: products.productKind,
    imageUrls: products.imageUrls,
    imageUpdatedAt: products.imageUpdatedAt,
    specs: products.specs,
    parentProductId: products.parentProductId,
    variantName: products.variantName,
    isVariantParent: products.isVariantParent,
    baseUnit: products.baseUnit,
    // Chỉ dùng nội bộ để gắn vào bảng giá vốn cho owner/manager bên dưới.
    // Không trả trực tiếp trường này ra client.
    costPrice: products.costPrice,
    retailPrice: products.retailPrice,
    wholesalePrice: products.wholesalePrice,
    contractorPrice: products.contractorPrice,
    agentPrice: products.agentPrice,
    priceByWeight: hasComplianceColumns ? products.priceByWeight : sql<boolean>`false`,
    m2PerUnit: products.m2PerUnit,
    categoryId: products.categoryId,
    categoryName: categories.name,
    lastSoldAt: lastCompletedSaleAt(),
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
        'priceOverride', ${productUnits.priceOverride}
      ) order by ${productUnits.sortOrder})
      from ${productUnits} where ${productUnits.productId} = ${products.id}
    ), '[]')`,
    // override giá theo bảng giá: { [priceBookId]: price }
    prices: sql<Record<string, string>>`coalesce((
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

/**
 * Bảng giá vốn không lưu product_prices, vì giá vốn có thể đổi sau mỗi phiếu nhập.
 * Chỉ nhúng giá vốn vào map giá khi caller đã được phép đọc bảng giá nội bộ.
 */
type CostPriceBookProduct = {
  costPrice: string;
  prices: Record<string, string>;
  children: CostPriceBookProduct[];
};

function applyCostPriceBooks(rows: CostPriceBookProduct[], costBookIds: string[]): void {
  for (const product of rows) {
    Object.assign(product.prices, Object.fromEntries(costBookIds.map((bookId) => [bookId, product.costPrice])));
    applyCostPriceBooks(product.children, costBookIds);
    // costPrice là dữ liệu nhạy cảm: chỉ trả ra dưới priceBookId nội bộ khi được phép.
    delete (product as { costPrice?: string }).costPrice;
  }
}

function activeRootCondition(storeId: string) {
  return and(
    eq(products.storeId, storeId),
    sql`${products.parentProductId} is null`,
    or(
      eq(products.isActive, true),
      sql`exists (
        select 1 from products child
        where child.parent_product_id = ${products.id}
          and child.is_active = true
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
      .select(posProductSelect(defaultWh?.id ?? null, hasComplianceColumns))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(activeRootCondition(storeId))
      .orderBy(...(options?.sort === "created"
        ? [desc(products.createdAt), desc(products.id)] as const
        : recentSaleOrder()))
      .limit(200),
    includeProductIds.length || includeProductSkus.length || includeProductCategories.length
      ? db
          .select(posProductSelect(defaultWh?.id ?? null, hasComplianceColumns))
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
        .select(posProductSelect(defaultWh?.id ?? null, hasComplianceColumns))
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(
          eq(products.storeId, storeId),
          eq(products.isActive, true),
          inArray(products.parentProductId, parentIds),
        ))
        .orderBy(...recentSaleOrder())
    : [];

  const productRows = attachChildren(rootRows, childRows);
  const byId = new Map(productRows.map((p) => [p.id, p]));
  for (const p of sourceProductRows) byId.set(p.id, p);
  const productsForPos = [...byId.values()];

  const priceBookRows = await getPriceBooks(storeId, {
    includeManagerOnly: options?.role === "owner" || options?.role === "manager",
  });

  const [promoRows, projectRows, defaultBankAccount] = await Promise.all([
    db
      .select({
        productId: promotions.productId,
        tiers: promotions.tiers,
        isActive: promotions.isActive,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
      })
      .from(promotions)
      .where(eq(promotions.isActive, true)),
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

  // map productId → tiers đang hiệu lực
  const promoByProduct: Record<string, PromoTier[]> = {};
  for (const p of promoRows) {
    if (isPromoActive(p)) promoByProduct[p.productId] = p.tiers ?? [];
  }

  const costBookIds = options?.role === "owner" || options?.role === "manager"
    ? priceBookRows.filter((book) => book.costBased).map((book) => book.id)
    : [];
  applyCostPriceBooks(productsForPos as unknown as CostPriceBookProduct[], costBookIds);

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

export async function getMobilePosData(storeId: string, role: Role) {
  // Reuse the POS dataset so mobile gets the same POS projection,
  // manager-only price books, stock reservations, and product image data.
  const data = await getPosData(storeId, { role, sort: "created" });
  return {
    ...data,
    products: data.products.slice(0, 30),
    customers: data.customers.slice(0, 100),
    projects: data.projects.slice(0, 100),
  };
}

/**
 * Tìm SP cho POS phía server (không phân biệt hoa/thường, không dấu) — quét
 * toàn bộ SP active để khớp đúng kết quả như trang Sản phẩm, không bị giới hạn
 * 200 SP của lưới mặc định.
 */
export async function searchPosProductRows(storeId: string, q: string): Promise<PosProduct[]> {
  const hasComplianceColumns = await hasProductComplianceColumns();
  const [defaultWh] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.storeId, storeId))
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const match: SQL | undefined = or(
    accentInsensitiveLike(products.name, q),
    accentInsensitiveLike(products.sku, q),
    accentInsensitiveLike(products.barcode, q)
  );

  const [childRows, rootRows] = await Promise.all([
    db
      .select(posProductSelect(defaultWh?.id ?? null, hasComplianceColumns))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(
        eq(products.storeId, storeId),
        eq(products.isActive, true),
        eq(products.isVariantParent, false),
        match,
      ))
      .orderBy(...recentSaleOrder())
      .limit(40),
    db
      .select(posProductSelect(defaultWh?.id ?? null, hasComplianceColumns))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(activeRootCondition(storeId), match))
      .orderBy(...recentSaleOrder())
      .limit(20),
  ]);

  const parentIds = rootRows.filter((p) => p.isVariantParent).map((p) => p.id);
  const pickerChildren = parentIds.length > 0
    ? await db
        .select(posProductSelect(defaultWh?.id ?? null, hasComplianceColumns))
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(
          eq(products.storeId, storeId),
          eq(products.isActive, true),
          inArray(products.parentProductId, parentIds),
        ))
      .orderBy(...recentSaleOrder())
    : [];

  const rootsWithChildren = attachChildren(rootRows, pickerChildren);
  const seen = new Set<string>();
  return [...childRows.map((p) => ({ ...p, children: [] })), ...rootsWithChildren].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export type PosData = Awaited<ReturnType<typeof getPosData>>;
export type PosProduct = PosData["products"][number];
export type PosCustomer = PosData["customers"][number];

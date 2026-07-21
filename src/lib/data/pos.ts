import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, customers, paymentBankAccounts, products, productPrices, productUnits, projects, promotions, stockLevels, warehouses } from "@/db/schema";
import { isPromoActive, type PromoTier } from "@/lib/promo";
import { getPriceBooks } from "@/lib/data/price-books";
import { getMobileProducts } from "@/lib/data/products";
import { accentInsensitiveLike } from "@/lib/search";

export interface PosUnit {
  unitName: string;
  multiplier: string;
  priceOverride: string | null;
}

/** Select dùng chung cho lưới POS + tìm kiếm (cùng shape PosProduct). */
function posProductSelect(warehouseId: string | null) {
  return {
    id: products.id,
    sku: products.sku,
    barcode: products.barcode,
    name: products.name,
    parentProductId: products.parentProductId,
    variantName: products.variantName,
    isVariantParent: products.isVariantParent,
    baseUnit: products.baseUnit,
    retailPrice: products.retailPrice,
    wholesalePrice: products.wholesalePrice,
    contractorPrice: products.contractorPrice,
    agentPrice: products.agentPrice,
    priceByWeight: products.priceByWeight,
    m2PerUnit: products.m2PerUnit,
    categoryId: products.categoryId,
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

function activeRootCondition() {
  return and(
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
export async function getPosData(options?: { includeProductIds?: string[] }) {
  const [defaultWh] = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const includeProductIds = [...new Set(options?.includeProductIds ?? [])];
  const [rootRows, sourceProductRows, customerRows] = await Promise.all([
    db
      .select(posProductSelect(defaultWh?.id ?? null))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(activeRootCondition())
      .orderBy(asc(products.name))
      .limit(200),
    includeProductIds.length
      ? db
          .select(posProductSelect(defaultWh?.id ?? null))
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(eq(products.isActive, true), inArray(products.id, includeProductIds)))
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
      .where(and(eq(customers.isActive, true)))
      .orderBy(asc(customers.name))
      .limit(500),
  ]);

  const parentIds = rootRows.filter((p) => p.isVariantParent).map((p) => p.id);
  const childRows = parentIds.length > 0
    ? await db
        .select(posProductSelect(defaultWh?.id ?? null))
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(eq(products.isActive, true), inArray(products.parentProductId, parentIds)))
        .orderBy(asc(products.name))
    : [];

  const productRows = attachChildren(rootRows, childRows);
  const byId = new Map(productRows.map((p) => [p.id, p]));
  for (const p of sourceProductRows) byId.set(p.id, p);
  const productsForPos = [...byId.values()];

  const priceBookRows = await getPriceBooks();

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
      .where(and(eq(paymentBankAccounts.provider, "sepay"), eq(paymentBankAccounts.enabled, true)))
      .orderBy(sql`${paymentBankAccounts.isDefault} desc`, asc(paymentBankAccounts.createdAt))
      .limit(1),
  ]);

  // map productId → tiers đang hiệu lực
  const promoByProduct: Record<string, PromoTier[]> = {};
  for (const p of promoRows) {
    if (isPromoActive(p)) promoByProduct[p.productId] = p.tiers ?? [];
  }

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

export async function getMobilePosData() {
  const [defaultWh] = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const [productPage, customerRows, priceBookRows, projectRows, defaultBankAccount] =
    await Promise.all([
      getMobileProducts({ pageSize: 30 }),
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
        .where(and(eq(customers.isActive, true)))
        .orderBy(asc(customers.name))
        .limit(100),
      getPriceBooks(),
      db
        .select({
          id: projects.id,
          name: projects.name,
          customerId: projects.customerId,
        })
        .from(projects)
        .where(eq(projects.status, "active"))
        .orderBy(asc(projects.name))
        .limit(100),
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
        .where(
          and(
            eq(paymentBankAccounts.provider, "sepay"),
            eq(paymentBankAccounts.enabled, true),
          ),
        )
        .orderBy(
          sql`${paymentBankAccounts.isDefault} desc`,
          asc(paymentBankAccounts.createdAt),
        )
        .limit(1),
    ]);

  return {
    warehouse: defaultWh ?? null,
    products: productPage.rows,
    customers: customerRows,
    promoByProduct: {},
    projects: projectRows,
    priceBooks: priceBookRows,
    defaultBankAccount: defaultBankAccount[0] ?? null,
  };
}

/**
 * Tìm SP cho POS phía server (không phân biệt hoa/thường, không dấu) — quét
 * toàn bộ SP active để khớp đúng kết quả như trang Sản phẩm, không bị giới hạn
 * 200 SP của lưới mặc định.
 */
export async function searchPosProductRows(q: string): Promise<PosProduct[]> {
  const [defaultWh] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const match: SQL | undefined = or(
    accentInsensitiveLike(products.name, q),
    accentInsensitiveLike(products.sku, q),
    accentInsensitiveLike(products.barcode, q)
  );

  const [childRows, rootRows] = await Promise.all([
    db
      .select(posProductSelect(defaultWh?.id ?? null))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(products.isActive, true), eq(products.isVariantParent, false), match))
      .orderBy(asc(products.name))
      .limit(40),
    db
      .select(posProductSelect(defaultWh?.id ?? null))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(activeRootCondition(), match))
      .orderBy(asc(products.name))
      .limit(20),
  ]);

  const parentIds = rootRows.filter((p) => p.isVariantParent).map((p) => p.id);
  const pickerChildren = parentIds.length > 0
    ? await db
        .select(posProductSelect(defaultWh?.id ?? null))
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(eq(products.isActive, true), inArray(products.parentProductId, parentIds)))
        .orderBy(asc(products.name))
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

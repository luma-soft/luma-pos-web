import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { categories, customers, products, productPrices, productUnits, projects, promotions, stockLevels, warehouses } from "@/db/schema";
import { isPromoActive, type PromoTier } from "@/lib/promo";
import { getPriceBooks } from "@/lib/data/price-books";
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
    baseUnit: products.baseUnit,
    retailPrice: products.retailPrice,
    wholesalePrice: products.wholesalePrice,
    contractorPrice: products.contractorPrice,
    agentPrice: products.agentPrice,
    m2PerUnit: products.m2PerUnit,
    categoryId: products.categoryId,
    categoryName: categories.name,
    stock: sql<string>`coalesce((
      select ${stockLevels.quantity} from ${stockLevels}
      where ${stockLevels.productId} = ${products.id}
        and ${stockLevels.warehouseId} = ${warehouseId ?? sql`null`}
    ), 0)`,
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
  };
}

/** Toàn bộ data POS cần khi mở trang: SP active + đơn vị + tồn kho mặc định, KH, kho. */
export async function getPosData() {
  const [defaultWh] = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault))
    .limit(1);

  const [productRows, customerRows] = await Promise.all([
    db
      .select(posProductSelect(defaultWh?.id ?? null))
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(200),
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

  const priceBookRows = await getPriceBooks();

  const [promoRows, projectRows] = await Promise.all([
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
  ]);

  // map productId → tiers đang hiệu lực
  const promoByProduct: Record<string, PromoTier[]> = {};
  for (const p of promoRows) {
    if (isPromoActive(p)) promoByProduct[p.productId] = p.tiers ?? [];
  }

  return {
    warehouse: defaultWh ?? null,
    products: productRows,
    customers: customerRows,
    promoByProduct,
    projects: projectRows,
    priceBooks: priceBookRows,
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

  return db
    .select(posProductSelect(defaultWh?.id ?? null))
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.isActive, true), match))
    .orderBy(asc(products.name))
    .limit(60);
}

export type PosData = Awaited<ReturnType<typeof getPosData>>;
export type PosProduct = PosData["products"][number];
export type PosCustomer = PosData["customers"][number];

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { priceBooks, productPrices } from "@/db/schema";
import type { SystemPriceBookType } from "@/lib/pricing/system-price-books";

export interface PriceBookRow {
  id: string;
  name: string;
  isDefault: boolean;
  managerOnly: boolean;
  costBased: boolean;
  systemType: SystemPriceBookType | null;
  sortOrder: number;
}

/** Danh sách bảng giá — mặc định lên đầu. */
export async function getPriceBooks(storeId: string, options?: { includeManagerOnly?: boolean }): Promise<PriceBookRow[]> {
  return db
    .select({
      id: priceBooks.id,
      name: priceBooks.name,
      isDefault: priceBooks.isDefault,
      managerOnly: priceBooks.managerOnly,
      costBased: priceBooks.costBased,
      systemType: priceBooks.systemType,
      sortOrder: priceBooks.sortOrder,
    })
    .from(priceBooks)
    .where(options?.includeManagerOnly === false
      ? and(eq(priceBooks.storeId, storeId), eq(priceBooks.managerOnly, false))
      : eq(priceBooks.storeId, storeId))
    .orderBy(desc(priceBooks.isDefault), asc(priceBooks.sortOrder), asc(priceBooks.name));
}

/**
 * Override giá của 1 bảng giá: productId → price (chuỗi decimal).
 * Truyền productIds để chỉ lấy override của các SP đang hiển thị (trang pricing
 * chỉ render 20 SP) → tránh load toàn bộ bảng productPrices mỗi book.
 */
export async function getPriceOverrides(
  storeId: string,
  priceBookId: string,
  productIds?: string[]
): Promise<Record<string, string>> {
  // không có SP nào → khỏi query
  if (productIds && productIds.length === 0) return {};

  const where = productIds
    ? and(
      eq(productPrices.storeId, storeId),
      eq(productPrices.priceBookId, priceBookId),
      inArray(productPrices.productId, productIds),
    )
    : and(
      eq(productPrices.storeId, storeId),
      eq(productPrices.priceBookId, priceBookId),
    );

  const rows = await db
    .select({ pid: productPrices.productId, price: productPrices.price })
    .from(productPrices)
    .innerJoin(priceBooks, and(eq(priceBooks.id, productPrices.priceBookId), eq(priceBooks.storeId, storeId)))
    .where(and(where, isNull(priceBooks.systemType), eq(priceBooks.isDefault, false), eq(priceBooks.costBased, false)));
  const m: Record<string, string> = {};
  for (const r of rows) m[r.pid] = r.price;
  return m;
}

/**
 * Override giá của TẤT CẢ bảng giá cho 1 nhóm SP — chỉ 1 query (thay vì N query/book).
 * Trả về: { [priceBookId]: { [productId]: price } }
 */
export async function getPriceOverridesForProducts(
  storeId: string,
  productIds: string[]
): Promise<Record<string, Record<string, string>>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .select({ book: productPrices.priceBookId, pid: productPrices.productId, price: productPrices.price })
    .from(productPrices)
    .innerJoin(priceBooks, and(eq(priceBooks.id, productPrices.priceBookId), eq(priceBooks.storeId, storeId)))
    .where(and(
      isNull(priceBooks.systemType), eq(priceBooks.isDefault, false), eq(priceBooks.costBased, false),
      eq(productPrices.storeId, storeId),
      inArray(productPrices.productId, productIds),
    ));
  const m: Record<string, Record<string, string>> = {};
  for (const r of rows) (m[r.book] ??= {})[r.pid] = r.price;
  return m;
}

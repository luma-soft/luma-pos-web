import { and, asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products, stockLevels } from "@/db/schema";
import { stockManagedCategoryCondition } from "@/lib/data/product-stock";
import { accentInsensitiveLike } from "@/lib/search";

export interface StocktakeProductOption {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  baseUnit: string;
  costPrice: number;
  stock: number;
}

/**
 * Tìm sản phẩm kiểm kho trên toàn bộ danh mục, không phụ thuộc danh sách
 * khởi tạo bị giới hạn của trang.
 */
export async function searchStocktakeProductRows(
  query: string,
  warehouseId: string,
): Promise<StocktakeProductOption[]> {
  const q = query.trim();
  if (!q || !warehouseId) return [];

  const match = or(
    accentInsensitiveLike(products.name, q),
    accentInsensitiveLike(products.sku, q),
    accentInsensitiveLike(products.barcode, q),
  );

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      baseUnit: products.baseUnit,
      costPrice: products.costPrice,
      stock: sql<string>`coalesce((
        select ${stockLevels.quantity} from ${stockLevels}
        where ${stockLevels.productId} = ${products.id}
          and ${stockLevels.warehouseId} = ${warehouseId}
      ), 0)`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(
      eq(products.isActive, true),
      stockManagedCategoryCondition(),
      match,
    ))
    .orderBy(asc(products.name))
    .limit(20);

  return rows.map((product) => ({
    ...product,
    costPrice: Number(product.costPrice),
    stock: Number(product.stock),
  }));
}

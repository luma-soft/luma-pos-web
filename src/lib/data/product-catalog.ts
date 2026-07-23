import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, products } from "@/db/schema";
import { accentInsensitiveLike } from "@/lib/search";

/** Thông tin lõi dùng chung cho mọi bộ chọn/tìm sản phẩm. */
export type ProductCatalogItem = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brandName: string | null;
  categoryName: string | null;
  baseUnit: string;
  retailPrice: string;
  updatedAt: Date;
};

/**
 * Nguồn dữ liệu chuẩn cho các màn hình cần tìm/chọn sản phẩm.
 * Các nghiệp vụ cần tồn kho, giá hoặc đơn vị mở rộng sẽ join dữ liệu riêng
 * sau khi đã có product id từ catalog này.
 */
export async function getProductCatalog(options: {
  query?: string;
  limit?: number;
} = {}): Promise<ProductCatalogItem[]> {
  const query = options.query?.trim();
  const where = query
    ? and(
        eq(products.isActive, true),
        or(
          accentInsensitiveLike(products.name, query),
          accentInsensitiveLike(products.sku, query),
          accentInsensitiveLike(products.barcode, query),
          accentInsensitiveLike(brands.name, query),
          accentInsensitiveLike(categories.name, query),
        ),
      )
    : eq(products.isActive, true);

  const result = db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      brandName: brands.name,
      categoryName: categories.name,
      baseUnit: products.baseUnit,
      retailPrice: products.retailPrice,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(where)
    .orderBy(asc(products.name));

  return options.limit ? result.limit(options.limit) : result;
}

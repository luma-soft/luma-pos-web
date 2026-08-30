import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, products } from "@/db/schema";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";

function firstImage(value: unknown) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function normalizeSpecs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      Array.isArray(item) && item.length ? [[key, item.map(String)]] : [],
    ),
  ) as Record<string, string[]>;
}

export type BrandPriceListProduct = {
  id: string;
  sku: string;
  name: string;
  fullName: string | null;
  category: string | null;
  baseUnit: string;
  retailPrice: number;
  warrantyMonths: number;
  description: string | null;
  imageUrl: string | null;
  specs: Record<string, string[]>;
};

export async function getBrandPriceListProducts(storeId: string, brandNames: string[]) {
  if (!brandNames.length) return [];

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      fullName: products.fullName,
      category: categories.name,
      baseUnit: products.baseUnit,
      retailPrice: products.retailPrice,
      warrantyMonths: products.warrantyMonths,
      description: products.description,
      imageUrls: productCompatibilityImageUrls(storeId),
      specs: products.specs,
    })
    .from(products)
    .innerJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(
      eq(products.storeId, storeId),
      brandNames.length === 1
        ? eq(brands.name, brandNames[0])
        : inArray(brands.name, brandNames),
    ))
    .orderBy(asc(categories.name), asc(products.name));

  return rows.map(
    (row): BrandPriceListProduct => ({
      ...row,
      retailPrice: Number(row.retailPrice),
      warrantyMonths: row.warrantyMonths ?? 0,
      imageUrl: firstImage(row.imageUrls),
      specs: normalizeSpecs(row.specs),
    }),
  );
}

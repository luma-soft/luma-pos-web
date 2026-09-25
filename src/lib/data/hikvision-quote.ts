import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, products } from "@/db/schema";
import { CAMERA_IP_QUOTE_SKUS } from "@/lib/data/camera-ip-quote";

export const HIKVISION_QUOTE_SKUS = CAMERA_IP_QUOTE_SKUS;

export type HikvisionQuoteProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  retailPrice: number;
  specs: Record<string, string[]>;
};

export async function getHikvisionQuoteProducts(storeId: string): Promise<HikvisionQuoteProduct[]> {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      brand: brands.name,
      retailPrice: products.retailPrice,
      specs: products.specs,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(and(eq(products.storeId, storeId), inArray(products.sku, [...HIKVISION_QUOTE_SKUS])))
    .orderBy(asc(products.name));

  return rows.map((row) => ({
    ...row,
    retailPrice: Number(row.retailPrice),
    specs: row.specs && typeof row.specs === "object" && !Array.isArray(row.specs)
      ? Object.fromEntries(Object.entries(row.specs).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.map(String)]))
      : {},
  }));
}

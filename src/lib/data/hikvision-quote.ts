import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, products } from "@/db/schema";

export const HIKVISION_QUOTE_SKUS = [
  "HK-IP-DS2CD1023G2-LIUF",
  "HK-IP-DS2CD1043G2-LIUF",
  "HK-NVR-DS7604NI-K1",
  "HK-NVR-DS7604NI-K1-4P",
  "HK-NVR-DS7608NI-K1",
  "HK-NVR-DS7608NI-K1-8P",
  "HK-SW-DS3E0106P-EM",
  "HK-SW-DS3E1310P-EIM",
  "SG-SKYHAWK-1TB",
  "SG-SKYHAWK-2TB",
  "SG-SKYHAWK-4TB",
  "MAT-HIK-IP-PER-CAMERA",
  "SVC-HIK-IP-INSTALL-PER-CAMERA",
  "UPS-HIK-650VA",
] as const;

export type HikvisionQuoteProduct = {
  sku: string;
  name: string;
  brand: string | null;
  retailPrice: number;
};

export async function getHikvisionQuoteProducts(): Promise<HikvisionQuoteProduct[]> {
  const rows = await db
    .select({
      sku: products.sku,
      name: products.name,
      brand: brands.name,
      retailPrice: products.retailPrice,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(inArray(products.sku, [...HIKVISION_QUOTE_SKUS]))
    .orderBy(asc(products.name));

  return rows.map((row) => ({ ...row, retailPrice: Number(row.retailPrice) }));
}

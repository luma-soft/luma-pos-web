import { and, asc, eq, inArray } from "drizzle-orm";
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
  "HK-IP-DS2CD1143G2-LIUF",
  "HK-PTZ-DS2DE2A404IW-DE3",
  "HK-NVR-DS7616NI-K1",
  "HK-NVR-DS7616NI-K2-16P",
  "HK-SW-DS3E1518P-SI",
  "SG-SKYHAWK-6TB",
  "ACC-HIK-RACK-6U",
  "ACC-HIK-MONITOR-22",
  "ACC-HIK-SURGE-PER-CAMERA",
  "504585",
] as const;

export type HikvisionQuoteProduct = {
  sku: string;
  name: string;
  brand: string | null;
  retailPrice: number;
  specs: Record<string, string[]>;
};

export async function getHikvisionQuoteProducts(storeId: string): Promise<HikvisionQuoteProduct[]> {
  const rows = await db
    .select({
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

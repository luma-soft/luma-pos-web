import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, customers, products, warehouses } from "@/db/schema";
import { productCompatibilityImageUrls } from "@/lib/products/product-media-read";
import {
  CAMERA_QUOTE_CARD_SKUS,
  CAMERA_QUOTE_DETAIL_MATERIAL_SKUS,
  CAMERA_QUOTE_INSTALL_SKUS,
  CAMERA_QUOTE_MATERIAL_SKUS,
} from "@/lib/data/camera-quote-constants";

const requiredSkus = [
  ...CAMERA_QUOTE_CARD_SKUS,
  ...CAMERA_QUOTE_INSTALL_SKUS,
  ...CAMERA_QUOTE_MATERIAL_SKUS,
];
const optionalMaterialSkus = CAMERA_QUOTE_DETAIL_MATERIAL_SKUS;

function firstImage(value: unknown) {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function normalizeSpecs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (!Array.isArray(item)) return [];
      return [[key, item.map(String)]];
    }),
  ) as Record<string, string[]>;
}

export type CameraQuoteProductOption = {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  brand: string | null;
  retailPrice: number;
  description: string | null;
  imageUrl: string | null;
  specs: Record<string, string[]>;
};

export async function getCameraQuoteFormOptions(storeId: string, includePrivate = false) {
  const [cameraRows, utilityRows, customerRows, warehouseRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        brand: brands.name,
        retailPrice: products.retailPrice,
        description: products.description,
        imageUrls: productCompatibilityImageUrls(storeId),
        specs: products.specs,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(and(eq(products.storeId, storeId), eq(categories.name, "Camera giám sát")))
      .orderBy(asc(products.name)),
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        brand: brands.name,
        retailPrice: products.retailPrice,
        description: products.description,
        imageUrls: productCompatibilityImageUrls(storeId),
        specs: products.specs,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(and(eq(products.storeId, storeId), inArray(products.sku, [...requiredSkus, ...optionalMaterialSkus]))),
    includePrivate ? db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        address: customers.address,
      })
      .from(customers)
      .where(and(eq(customers.storeId, storeId), eq(customers.isActive, true)))
      .orderBy(desc(customers.createdAt))
      .limit(500) : Promise.resolve([]),
    includePrivate ? db
      .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
      .from(warehouses)
      .where(eq(warehouses.storeId, storeId))
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name)) : Promise.resolve([]),
  ]);

  const utilityBySku = new Map(utilityRows.map((row) => [row.sku, row]));
  const mapProduct = (row: (typeof cameraRows)[number]): CameraQuoteProductOption => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    baseUnit: row.baseUnit,
    brand: row.brand,
    retailPrice: Number(row.retailPrice),
    description: row.description,
    imageUrl: firstImage(row.imageUrls),
    specs: normalizeSpecs(row.specs),
  });

  return {
    cameras: cameraRows.map(mapProduct),
    cards: CAMERA_QUOTE_CARD_SKUS.flatMap((sku) => {
      const row = utilityBySku.get(sku);
      return row ? [mapProduct(row)] : [];
    }),
    installations: CAMERA_QUOTE_INSTALL_SKUS.flatMap((sku) => {
      const row = utilityBySku.get(sku);
      return row ? [mapProduct(row)] : [];
    }),
    materials: [
      ...CAMERA_QUOTE_MATERIAL_SKUS.flatMap((sku) => {
        const row = utilityBySku.get(sku);
        return row ? [mapProduct(row)] : [];
      }),
      ...optionalMaterialSkus.flatMap((sku) => {
        const row = utilityBySku.get(sku);
        return row ? [mapProduct(row)] : [];
      }),
    ],
    customers: customerRows,
    warehouses: warehouseRows,
    defaultWarehouseId: warehouseRows.find((row) => row.isDefault)?.id ?? warehouseRows[0]?.id ?? null,
  };
}

export type CameraQuoteFormOptions = Awaited<ReturnType<typeof getCameraQuoteFormOptions>>;

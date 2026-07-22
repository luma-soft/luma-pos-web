import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, customers, products, warehouses } from "@/db/schema";

export const CAMERA_QUOTE_CARD_SKUS = ["MEM-HIK-32GB", "MEM-IMOU-64GB"] as const;
export const CAMERA_QUOTE_INSTALL_SKUS = [
  "SVC-CAM-INSTALL-200",
  "SVC-CAM-INSTALL-250",
  "SVC-CAM-INSTALL-300",
] as const;
export const CAMERA_QUOTE_MATERIAL_SKUS = [
  "MAT-CAM-BASIC-50",
  "MAT-CAM-OUT-80",
  "MAT-CAM-PTZ-100",
] as const;

const requiredSkus = [
  ...CAMERA_QUOTE_CARD_SKUS,
  ...CAMERA_QUOTE_INSTALL_SKUS,
  ...CAMERA_QUOTE_MATERIAL_SKUS,
];

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
  retailPrice: number;
  description: string | null;
  imageUrl: string | null;
  specs: Record<string, string[]>;
};

export async function getCameraQuoteFormOptions() {
  const [cameraRows, utilityRows, customerRows, warehouseRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        retailPrice: products.retailPrice,
        description: products.description,
        imageUrls: products.imageUrls,
        specs: products.specs,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(categories.name, "Camera giám sát"))
      .orderBy(asc(products.name)),
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        baseUnit: products.baseUnit,
        retailPrice: products.retailPrice,
        description: products.description,
        imageUrls: products.imageUrls,
        specs: products.specs,
      })
      .from(products)
      .where(inArray(products.sku, requiredSkus)),
    db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        address: customers.address,
      })
      .from(customers)
      .where(eq(customers.isActive, true))
      .orderBy(desc(customers.createdAt))
      .limit(500),
    db
      .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
      .from(warehouses)
      .orderBy(desc(warehouses.isDefault), asc(warehouses.name)),
  ]);

  const utilityBySku = new Map(utilityRows.map((row) => [row.sku, row]));
  const missing = requiredSkus.filter((sku) => !utilityBySku.has(sku));
  if (missing.length > 0) {
    throw new Error(`Thiếu sản phẩm cấu hình báo giá: ${missing.join(", ")}`);
  }

  const mapProduct = (row: (typeof cameraRows)[number]): CameraQuoteProductOption => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    baseUnit: row.baseUnit,
    retailPrice: Number(row.retailPrice),
    description: row.description,
    imageUrl: firstImage(row.imageUrls),
    specs: normalizeSpecs(row.specs),
  });

  return {
    cameras: cameraRows.map(mapProduct),
    cards: CAMERA_QUOTE_CARD_SKUS.map((sku) => mapProduct(utilityBySku.get(sku)!)),
    installations: CAMERA_QUOTE_INSTALL_SKUS.map((sku) => mapProduct(utilityBySku.get(sku)!)),
    materials: CAMERA_QUOTE_MATERIAL_SKUS.map((sku) => mapProduct(utilityBySku.get(sku)!)),
    customers: customerRows,
    warehouses: warehouseRows,
    defaultWarehouseId: warehouseRows.find((row) => row.isDefault)?.id ?? warehouseRows[0]?.id ?? null,
  };
}

export type CameraQuoteFormOptions = Awaited<ReturnType<typeof getCameraQuoteFormOptions>>;

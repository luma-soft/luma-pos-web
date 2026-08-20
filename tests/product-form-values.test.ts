import { describe, expect, test } from "bun:test";
import { productToFormInitialValues } from "@/app/(app)/products/product-form-values";

const unitId = "10000000-0000-4000-8000-000000000001";
const product = {
  productKind: "product",
  sku: "CAP-CAT5E",
  barcode: null,
  name: "Dây mạng Cat5E",
  categoryId: "category-1",
  brandId: "brand-1",
  suppliers: [],
  baseUnit: "m",
  costPrice: "5573.77",
  retailPrice: "8196.72",
  wholesalePrice: null,
  contractorPrice: null,
  agentPrice: null,
  units: [{
    id: unitId,
    unitName: "cuộn",
    multiplier: "305.0000",
    barcode: null,
    priceOverride: "2500000.00",
  }],
  comboItems: [],
  specs: null,
  location: null,
  imageUrls: [],
  description: null,
  isActive: true,
} as never;

describe("product form unit identity", () => {
  test("retains unit ids only when editing the original product", () => {
    expect(productToFormInitialValues(product, "edit").units?.[0]?.id).toBe(unitId);
    expect(productToFormInitialValues(product, "copy").units?.[0]?.id).toBeUndefined();
    expect(productToFormInitialValues(product, "sameType").units?.[0]?.id).toBeUndefined();
  });
});

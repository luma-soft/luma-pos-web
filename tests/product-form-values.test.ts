import { describe, expect, test } from "bun:test";
import { productToFormInitialValues } from "@/app/(app)/products/product-form-values";

const unitId = "10000000-0000-4000-8000-000000000001";
const mediaId = "20000000-0000-4000-8000-000000000001";
const storeId = "30000000-0000-4000-8000-000000000001";
const publicMedia = {
  publicBaseUrl: "https://media.staging.lumapos.test",
  publicBucket: "staging-public-media",
};
const managedUrl =
  `${publicMedia.publicBaseUrl}/stores/${storeId}/products/2026/08/${mediaId}/original.webp`;
const externalUrl = "https://vendor.test/catalog/cat5e.jpg";
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
  imageUrls: [managedUrl, externalUrl],
  imageMedia: [{
    mediaId,
    url: managedUrl,
    path: `stores/${storeId}/products/2026/08/${mediaId}/original.webp`,
  }],
  description: null,
  isActive: true,
};

describe("product form unit identity", () => {
  test("retains unit ids only when editing the original product", () => {
    expect(productToFormInitialValues(product as never, "edit", {}, publicMedia).units?.[0]?.id).toBe(unitId);
    expect(productToFormInitialValues(product as never, "copy", {}, publicMedia).units?.[0]?.id).toBeUndefined();
    expect(productToFormInitialValues(product as never, "sameType", {}, publicMedia).units?.[0]?.id).toBeUndefined();
  });

  test("retains managed IDs for edit and never copies their first-party URLs", () => {
    expect(productToFormInitialValues(product as never, "edit", {}, publicMedia)).toMatchObject({
      imageUrls: [managedUrl, externalUrl],
      imageMediaIds: [mediaId],
    });
    expect(productToFormInitialValues(product as never, "copy", {}, publicMedia)).toMatchObject({
      imageUrls: [externalUrl],
      imageMediaIds: [],
    });
    expect(productToFormInitialValues(product as never, "sameType", {}, publicMedia)).toMatchObject({
      imageUrls: [],
    });
    expect(productToFormInitialValues({
      ...product,
      imageMedia: [],
    } as never, "copy", {}, publicMedia)).toMatchObject({
      imageUrls: [externalUrl],
      imageMediaIds: [],
    });
  });
});

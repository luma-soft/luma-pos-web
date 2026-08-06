import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const queries: Array<Record<string, unknown>> = [];

mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockAccess: async () => ({ ok: true }),
  requireMobileStockReadAccess: async () => ({ ok: true }),
}));

mock.module("@/lib/data/pricing", () => ({
  getPricingCategories: async () => [{ id: "lights", name: "Đèn" }],
  getPricingBrands: async () => [{ id: "brand", name: "3S" }],
  getPricingSuppliers: async () => [{ id: "supplier", name: "3S LED" }],
  getPricingPage: async (query: Record<string, unknown>) => {
    queries.push(query);
    return {
      rows: [
        {
          id: "product-1",
          sku: "LED-12W",
          barcode: "8930001",
          name: "Đèn LED 12W",
          categoryId: "lights",
          categoryName: "Đèn",
          brandId: "brand",
          supplierId: "supplier",
          imageUrls: ["https://cdn.example/led.webp"],
          baseUnit: "cái",
          productKind: "product",
          lifecycleStatus: "active",
          trackBatches: false,
          shelfLifeDays: null,
          minStock: 5,
          units: [{ unitName: "cái", multiplier: 1, barcode: "8930001" }],
          parentProductId: null,
          variantName: null,
          isVariantParent: false,
          baseRetailPrice: 120000,
          costPrice: 95000,
          lastPurchasePrice: 95000,
          availableStock: 48,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 30,
      pageCount: 1,
    };
  },
}));

let getBrowse: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ GET: getBrowse } =
    await import("../src/app/api/mobile/products/browse/route"));
});

beforeEach(() => queries.splice(0));

describe("GET /api/mobile/products/browse", () => {
  test.each([
    "negativeStock",
    "outOfStock",
    "lowStock",
    "inStock",
  ])("forwards the %s inventory status", async (stock) => {
    const response = await getBrowse(
      new Request(
        `https://luma.test/api/mobile/products/browse?stock=${stock}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.stock).toBe(stock);
  });

  test("forwards common filters, pagination, and selected warehouse", async () => {
    const response = await getBrowse(
      new Request(
        "https://luma.test/api/mobile/products/browse?q=led&categoryIds=lights&brandIds=brand&supplierIds=supplier&stock=available&productKind=product&lifecycle=active&sort=stock&warehouseId=warehouse-1&page=2&pageSize=30",
      ),
    );

    expect(response.status).toBe(200);
    expect(queries).toEqual([
      {
        q: "led",
        categoryIds: ["lights"],
        brandIds: ["brand"],
        supplierIds: ["supplier"],
        stock: "available",
        productKind: "product",
        lifecycle: "active",
        sort: "stock",
        warehouseId: "warehouse-1",
        page: 2,
        pageSize: 30,
      },
    ]);
  });

  test("forwards every selected category for live count previews", async () => {
    const response = await getBrowse(
      new Request(
        "https://luma.test/api/mobile/products/browse?categoryIds=lights,cameras,services&page=1&pageSize=1",
      ),
    );

    expect(response.status).toBe(200);
    expect(queries[0]?.categoryIds).toEqual(["lights", "cameras", "services"]);
    expect(queries[0]?.pageSize).toBe(1);
  });

  test("returns the browse projection and filter options", async () => {
    const response = await getBrowse(
      new Request("https://luma.test/api/mobile/products/browse"),
    );
    const payload = await response.json();

    expect(payload.data).toMatchObject({
      total: 1,
      categories: [{ id: "lights", name: "Đèn" }],
      rows: [
        {
          id: "product-1",
          baseUnit: "cái",
          availableStock: 48,
          imageUrl: "https://cdn.example/led.webp",
          units: [{ unitName: "cái", multiplier: 1 }],
        },
      ],
    });
  });
});

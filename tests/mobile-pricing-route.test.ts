import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const pricingQueries: Array<Record<string, unknown>> = [];

mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockAccess: async () => ({ ok: true }),
}));

mock.module("@/lib/data/pricing", () => ({
  getPricingCategories: async () => [
    { id: "camera", name: "Camera giám sát" },
  ],
  getPricingBrands: async () => [{ id: "hikvision", name: "Hikvision" }],
  getPricingSuppliers: async () => [{ id: "supplier-a", name: "NCC A" }],
  getPricingPage: async (query: Record<string, unknown>) => {
    pricingQueries.push(query);
    return {
      rows: [
        {
          id: "product-child",
          sku: "CAM-CHILD-01",
          barcode: "893000000001",
          name: "Camera con",
          categoryId: "camera",
          categoryName: "Camera giám sát",
          imageUrls: ["https://cdn.example/camera.webp"],
          parentProductId: "product-parent",
          variantName: "Trắng",
          isVariantParent: false,
          baseRetailPrice: 150000,
          costPrice: 95000,
          lastPurchasePrice: 98000,
        },
      ],
      total: 51,
      page: Number(query.page),
      pageSize: Number(query.pageSize),
      pageCount: 2,
    };
  },
}));

mock.module("@/lib/data/price-books", () => ({
  getPriceBooks: async () => [
    {
      id: "retail",
      name: "Giá chung",
      isDefault: true,
      managerOnly: false,
      costBased: false,
      sortOrder: 0,
    },
    {
      id: "vip",
      name: "Giá VIP",
      isDefault: false,
      managerOnly: false,
      costBased: false,
      sortOrder: 1,
    },
  ],
  getPriceOverridesForProducts: async () => ({
    vip: { "product-child": "140000" },
  }),
}));

let getPricing: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ GET: getPricing } = await import(
    "../src/app/api/mobile/pricing/route"
  ));
});

beforeEach(() => pricingQueries.splice(0));

describe("GET /api/mobile/pricing", () => {
  test("forwards the product-tab filters and selected-book price sort", async () => {
    const response = await getPricing(
      new Request(
        "https://luma.test/api/mobile/pricing?q=camera&categoryIds=camera&brandIds=hikvision&supplierIds=supplier-a&stock=lowStock&productKind=product&lifecycle=active&sort=retail&priceBookId=vip&page=2&pageSize=50",
      ),
    );

    expect(response.status).toBe(200);
    expect(pricingQueries).toEqual([
      {
        q: "camera",
        categoryIds: ["camera"],
        brandIds: ["hikvision"],
        supplierIds: ["supplier-a"],
        stock: "lowStock",
        productKind: "product",
        lifecycle: "active",
        sort: "retail",
        priceBookId: "vip",
        page: 2,
        pageSize: 50,
      },
    ]);
  });

  test("returns the typed catalog and pricing overlay contract", async () => {
    const response = await getPricing(
      new Request("https://luma.test/api/mobile/pricing?page=1&pageSize=50"),
    );
    const payload = await response.json();

    expect(payload.data).toMatchObject({
      total: 51,
      page: 1,
      pageSize: 50,
      pageCount: 2,
      categories: [{ id: "camera", name: "Camera giám sát" }],
      brands: [{ id: "hikvision", name: "Hikvision" }],
      suppliers: [{ id: "supplier-a", name: "NCC A" }],
      rows: [
        {
          id: "product-child",
          sku: "CAM-CHILD-01",
          barcode: "893000000001",
          categoryId: "camera",
          categoryName: "Camera giám sát",
          imageUrl: "https://cdn.example/camera.webp",
          imageUrls: ["https://cdn.example/camera.webp"],
          parentProductId: "product-parent",
          variantName: "Trắng",
          isVariantParent: false,
          baseRetailPrice: 150000,
          overridesByBookId: { vip: 140000 },
        },
      ],
    });
    expect(payload.data.rows[0].overridesByBookId).not.toHaveProperty("retail");
  });

  test("ignores priceBookId unless sorting by effective price", async () => {
    await getPricing(
      new Request(
        "https://luma.test/api/mobile/pricing?sort=name&priceBookId=vip",
      ),
    );
    expect(pricingQueries[0]).toMatchObject({
      sort: "name",
      priceBookId: undefined,
    });
  });
});

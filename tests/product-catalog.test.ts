import { describe, expect, test } from "bun:test";
import {
  getCatalogWarehouseStock,
  searchProductCatalog,
  type ProductCatalogItem,
} from "@/lib/product-catalog";
import { catalogItemToPosProduct } from "@/lib/pos/product-catalog-adapter";

function product(overrides: Partial<ProductCatalogItem> = {}): ProductCatalogItem {
  return {
    id: "memory-card",
    sku: "MEM-KIOXIA-128GB",
    barcode: "8930000000128",
    name: "Thẻ nhớ Kioxia 128GB MicroSD",
    brandName: "Kioxia",
    categoryId: "memory",
    categoryName: "Thẻ nhớ",
    baseUnit: "cái",
    costPrice: "100000",
    retailPrice: "150000",
    wholesalePrice: null,
    contractorPrice: null,
    agentPrice: null,
    imageUrls: [],
    specs: null,
    parentProductId: null,
    variantName: null,
    isVariantParent: false,
    m2PerUnit: null,
    priceByWeight: false,
    isStockManaged: true,
    units: [{ unitName: "hộp", multiplier: "10", barcode: "8930000000999", priceOverride: null }],
    prices: {},
    warehouseStock: [
      { warehouseId: "main", quantity: "7", reserved: "1", minLevel: "2" },
      { warehouseId: "secondary", quantity: "3", reserved: "0", minLevel: "0" },
    ],
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("shared product catalog", () => {
  test("finds products beyond former screen limits without accents", () => {
    const products = [
      ...Array.from({ length: 500 }, (_, index) => product({
        id: `initial-${index}`,
        sku: `SKU-${index}`,
        barcode: null,
        name: `Sản phẩm ${index}`,
        brandName: null,
        categoryId: null,
        categoryName: null,
        units: [],
      })),
      product(),
    ];

    expect(searchProductCatalog(products, "the nho")).toEqual([product()]);
  });

  test("searches unit barcodes and honors stock-managed filtering", () => {
    expect(searchProductCatalog([product()], "8930000000999")).toHaveLength(1);
    expect(searchProductCatalog(
      [product({ isStockManaged: false })],
      "the nho",
      { stockManagedOnly: true },
    )).toEqual([]);
  });

  test("selects stock for the active warehouse", () => {
    expect(getCatalogWarehouseStock(product(), "secondary")).toBe(3);
    expect(getCatalogWarehouseStock(product(), "missing")).toBe(0);
  });

  test("aggregates variant stock only inside the selected warehouse", () => {
    const parent = product({
      id: "parent",
      sku: "PARENT",
      name: "Thẻ nhớ",
      isVariantParent: true,
      warehouseStock: [],
    });
    const children = [
      product({
        id: "child-1",
        parentProductId: parent.id,
        warehouseStock: [
          { warehouseId: "main", quantity: "10", reserved: "0", minLevel: "0" },
          { warehouseId: "secondary", quantity: "2", reserved: "0", minLevel: "0" },
        ],
      }),
      product({
        id: "child-2",
        parentProductId: parent.id,
        warehouseStock: [
          { warehouseId: "main", quantity: "20", reserved: "0", minLevel: "0" },
          { warehouseId: "secondary", quantity: "3", reserved: "0", minLevel: "0" },
        ],
      }),
    ];

    const result = catalogItemToPosProduct(parent, [parent, ...children], "secondary");
    expect(result.stock).toBe("5");
    expect(result.children).toHaveLength(2);
  });
});

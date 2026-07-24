import { describe, expect, test } from "bun:test";
import { getStocktakeSuggestions } from "@/lib/stocktake-product-search";

type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
};

describe("stocktake product search", () => {
  test("uses full-catalog server results when the product is outside the initial page", () => {
    const initialProducts: Product[] = Array.from({ length: 500 }, (_, index) => ({
      id: `initial-${index}`,
      sku: `SKU-${index}`,
      barcode: null,
      name: `Sản phẩm ${index}`,
    }));
    const memoryCard: Product = {
      id: "memory-card",
      sku: "MEM-KIOXIA-128GB",
      barcode: "8930000000128",
      name: "Thẻ nhớ Kioxia 128GB MicroSD",
    };

    expect(getStocktakeSuggestions({
      search: "the nho",
      localProducts: initialProducts,
      serverResults: [memoryCard],
      addedProductIds: new Set(),
    })).toEqual([memoryCard]);
  });

  test("local fallback matches Vietnamese text without accents and barcode", () => {
    const product: Product = {
      id: "memory-card",
      sku: "MEM-KIOXIA-128GB",
      barcode: "8930000000128",
      name: "Thẻ nhớ Kioxia 128GB MicroSD",
    };

    expect(getStocktakeSuggestions({
      search: "the nho",
      localProducts: [product],
      serverResults: [],
      addedProductIds: new Set(),
    })).toEqual([product]);
    expect(getStocktakeSuggestions({
      search: "8930000000128",
      localProducts: [product],
      serverResults: [],
      addedProductIds: new Set(),
    })).toEqual([product]);
  });
});

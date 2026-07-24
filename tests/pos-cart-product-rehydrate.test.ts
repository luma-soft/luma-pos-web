import { describe, expect, test } from "bun:test";
import { rehydrateCartProducts } from "../src/lib/pos/rehydrate-cart-products";

describe("rehydrateCartProducts", () => {
  test("replaces a stale product snapshot with current stock metadata", () => {
    const cart = [{
      key: "line-1",
      quantity: 2,
      unitPrice: 200_000,
      product: { id: "service-1", name: "Công lắp đặt camera" },
    }];
    const currentProducts = [{
      id: "service-1",
      name: "Công lắp đặt camera - cơ bản",
      categoryName: "Dịch Vụ",
      stock: "-6",
    }];

    expect(rehydrateCartProducts(cart, currentProducts)).toEqual([{
      ...cart[0],
      product: currentProducts[0],
    }]);
  });

  test("keeps the snapshot when the product is no longer in the catalog", () => {
    const cart = [{
      key: "line-1",
      quantity: 1,
      product: { id: "archived-1", name: "Sản phẩm đã lưu trữ" },
    }];

    expect(rehydrateCartProducts(cart, [])).toEqual(cart);
  });
});

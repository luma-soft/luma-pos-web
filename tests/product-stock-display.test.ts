import { describe, expect, test } from "bun:test";
import {
  isProductStockManaged,
  productStockDisplay,
  productStockQuantityDisplay,
} from "../src/lib/product-stock";

describe("product stock display", () => {
  test("recognizes untracked service categories regardless of casing or whitespace", () => {
    expect(isProductStockManaged("  DỊCH VỤ ")).toBe(false);
    expect(isProductStockManaged("Camera giám sát")).toBe(true);
    expect(isProductStockManaged(null)).toBe(true);
  });

  test("does not present service units as physical inventory", () => {
    const service = {
      categoryName: "Dịch Vụ",
      totalStock: -4,
      baseUnit: "điểm",
    };

    expect(productStockQuantityDisplay(service)).toBeNull();
    expect(
      productStockDisplay(service, "Không quản lý tồn"),
    ).toBe("Không quản lý tồn");
  });

  test("keeps quantity and unit for stock-managed products", () => {
    expect(
      productStockDisplay(
        { categoryName: "Camera giám sát", totalStock: 3, baseUnit: "cái" },
        "Không quản lý tồn",
      ),
    ).toBe("3 cái");
  });
});

import { describe, expect, test } from "bun:test";
import { productStockDisplay } from "../src/app/(app)/inventory/tabs/product-stock-display";

describe("product stock display", () => {
  test("does not present service units as physical inventory", () => {
    expect(
      productStockDisplay(
        { categoryName: "Dịch Vụ", totalStock: 0, baseUnit: "điểm" },
        "Không quản lý tồn",
      ),
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

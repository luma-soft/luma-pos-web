import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const inventorySearchFiles = [
  "src/app/(app)/inventory/tabs/instant-product-search.tsx",
  "src/app/(app)/inventory/tabs/camera-material-search.tsx",
  "src/app/(app)/inventory/tabs/stock.tsx",
  "src/app/(app)/inventory/tabs/pricing.tsx",
  "src/app/(app)/inventory/tabs/purchases.tsx",
  "src/app/(app)/inventory/tabs/purchase-returns.tsx",
];

describe("inventory search focus treatment", () => {
  test("uses one primary border without an outline or ring layer", () => {
    for (const file of inventorySearchFiles) {
      const source = readFileSync(file, "utf8");

      expect(source).toContain("focus:border-primary-500");
      expect(source).toContain("focus:outline-none");
      expect(source).not.toContain("focus:ring-2");
    }
  });
});

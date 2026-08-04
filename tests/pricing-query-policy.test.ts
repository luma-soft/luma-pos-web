import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parsePricingSort,
  pricingProjectionPolicy,
  pricingSortSpec,
} from "@/lib/pricing/pricing-policy";

describe("mobile pricing query policy", () => {
  test("accepts supported sorts and falls back safely", () => {
    expect(parsePricingSort("retail")).toBe("retail");
    expect(parsePricingSort("stock")).toBe("stock");
    expect(parsePricingSort("cost")).toBe("cost");
    expect(parsePricingSort("unknown")).toBe("updated");
    expect(parsePricingSort(undefined)).toBe("updated");
  });

  test("uses product id as the stable tie-breaker for every sort", () => {
    for (const sort of ["updated", "name", "sku", "cost", "retail", "stock"] as const) {
      expect(pricingSortSpec(sort)[1]).toEqual({
        key: "id",
        direction: "asc",
      });
    }
    expect(pricingSortSpec("retail")[0]).toEqual({
      key: "effectivePrice",
      direction: "desc",
    });
  });

  test("defines pricing products as active sellable flat SKUs", () => {
    expect(pricingProjectionPolicy).toEqual({
      isVariantParent: false,
      isActive: true,
      lifecycleStatus: "active",
    });
  });

  test("listing and bulk formula reuse the same projection predicate", () => {
    const pricingSource = readFileSync(
      new URL("../src/lib/data/pricing.ts", import.meta.url),
      "utf8",
    );
    const formulaSource = readFileSync(
      new URL("../src/lib/actions/price-books.ts", import.meta.url),
      "utf8",
    );
    expect(pricingSource).toContain("pricingSellableProductCondition()");
    expect(formulaSource.match(/pricingSellableProductCondition\(\)/g)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  test("single-price updates require manager access without PIN re-auth", () => {
    const routeSource = readFileSync(
      new URL("../src/app/api/mobile/pricing/price/route.ts", import.meta.url),
      "utf8",
    );
    expect(routeSource).toContain("requireMobileManager()");
    expect(routeSource).not.toContain("authorizeMobileSensitiveAction");
    expect(routeSource).not.toContain("approvalRequired");
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const invalidate = mock((_path: string, _type?: "page" | "layout") => undefined);
mock.module("next/cache", () => ({ revalidatePath: invalidate }));
const { revalidateAppData } = await import("@/lib/sync/revalidate-app-data");

afterEach(() => invalidate.mockClear());

describe("shared successful-mutation revalidation", () => {
  test("invalidates the related authenticated detail/list/modal tree with the explicit path", () => {
    revalidateAppData("/products/product-1");
    expect(invalidate.mock.calls).toEqual([
      ["/products/product-1", undefined],
      ["/(app)", "layout"],
    ]);
  });

  test("preserves dynamic-route types and does not repeat an app-layout invalidation", () => {
    revalidateAppData("/products/[id]/labels", "page");
    expect(invalidate.mock.calls).toEqual([
      ["/products/[id]/labels", "page"],
      ["/(app)", "layout"],
    ]);
    invalidate.mockClear();
    revalidateAppData("/(app)", "layout");
    expect(invalidate.mock.calls).toEqual([["/(app)", "layout"]]);
  });

  test("all existing CRUD invalidation boundaries use the shared policy", () => {
    const modules = [
      "actions/products", "actions/partners", "actions/purchases", "actions/purchase-returns",
      "actions/stocktakes", "actions/internal-use", "actions/order-edit", "actions/orders",
      "actions/returns", "actions/cashbook", "actions/shifts", "actions/services", "actions/extras",
      "actions/settings", "actions/price-books", "actions/import", "actions/marketplace",
      "actions/einvoice", "actions/delivery", "actions/modifiers", "actions/tables", "actions/kitchen",
      "actions/print-templates", "actions/label-templates", "actions/zalo", "actions/onboarding",
      "orders/create", "orders/cancel", "orders/convert", "orders/payment", "receivables/service", "payables/service",
    ];
    for (const module of modules) {
      expect(readFileSync(`src/lib/${module}.ts`, "utf8")).toContain(
        'import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";',
      );
    }
    for (const readOnly of ["actions/product-catalog", "data/product-catalog"]) {
      expect(readFileSync(`src/lib/${readOnly}.ts`, "utf8")).not.toContain("revalidateAppData");
    }
  });
});

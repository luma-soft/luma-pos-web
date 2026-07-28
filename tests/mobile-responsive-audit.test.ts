import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const responsiveRecordSources = [
  {
    path: "src/app/(app)/orders/[id]/order-detail-panel.tsx",
    markers: ["order-payments", "order-returns"],
  },
  {
    path: "src/app/(app)/sales/tabs/return-detail-panel.tsx",
    markers: ["sales-return-items"],
  },
  {
    path: "src/app/(app)/online-sales/page.tsx",
    markers: ["online-listings", "online-orders"],
  },
  {
    path: "src/app/(app)/inventory/tabs/purchases-table.tsx",
    markers: ["inventory-purchase-items"],
  },
  {
    path: "src/app/(app)/inventory/tabs/purchase-returns-table.tsx",
    markers: ["inventory-purchase-return-items"],
  },
  {
    path: "src/app/(app)/inventory/tabs/internal-use-table.tsx",
    markers: ["inventory-internal-use-items"],
  },
  {
    path: "src/app/(app)/inventory/tabs/stock-table.tsx",
    markers: ["inventory-stock-location"],
  },
  {
    path: "src/app/(app)/inventory/tabs/products-table.tsx",
    markers: [
      "product-stock-card",
      "product-stock-location",
      "product-related",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/stock.tsx",
    markers: ["inventory-recent-movements"],
  },
  {
    path: "src/app/(app)/partners/tabs/suppliers-table.tsx",
    markers: ["supplier-history", "supplier-debt"],
  },
  {
    path: "src/app/(app)/partners/tabs/customers-table.tsx",
    markers: ["customer-sales", "customer-debt", "customer-order-preview"],
  },
  {
    path: "src/app/(app)/products/new/product-form.tsx",
    markers: ["product-variants", "product-price-books"],
  },
  {
    path: "src/app/(app)/settings/settings-client.tsx",
    markers: ["settings-staff", "settings-permissions"],
  },
  {
    path: "src/app/(app)/settings/import/import-client.tsx",
    markers: ["settings-import-preview"],
  },
] as const;

describe("route-wide mobile responsive audit", () => {
  test("every confirmed wide record surface has a dedicated mobile renderer", () => {
    for (const { path, markers } of responsiveRecordSources) {
      const source = read(path);
      for (const marker of markers) {
        expect(source).toContain(`data-mobile-audit="${marker}"`);
      }
    }
  });

  test("desktop wide tables are breakpoint-isolated after mobile renderers", () => {
    for (const path of [
      "src/app/(app)/orders/[id]/order-detail-panel.tsx",
      "src/app/(app)/sales/tabs/return-detail-panel.tsx",
      "src/app/(app)/online-sales/page.tsx",
      "src/app/(app)/inventory/tabs/purchases-table.tsx",
      "src/app/(app)/inventory/tabs/purchase-returns-table.tsx",
      "src/app/(app)/inventory/tabs/internal-use-table.tsx",
      "src/app/(app)/inventory/tabs/stock-table.tsx",
      "src/app/(app)/inventory/tabs/products-table.tsx",
      "src/app/(app)/inventory/tabs/stock.tsx",
      "src/app/(app)/partners/tabs/suppliers-table.tsx",
      "src/app/(app)/partners/tabs/customers-table.tsx",
    ]) {
      expect(read(path)).toMatch(
        /className="hidden[^"]*(?:overflow-x-auto|overflow-auto)[^"]*lg:block|className="hidden[^"]*lg:block[^"]*(?:overflow-x-auto|overflow-auto)/,
      );
    }

    expect(read("src/app/(app)/products/new/product-form.tsx")).toContain(
      "block w-full min-w-0 text-sm lg:table lg:min-w-",
    );
    expect(read("src/app/(app)/settings/settings-client.tsx")).toContain(
      "block w-full text-sm md:table",
    );
    expect(read("src/app/(app)/settings/import/import-client.tsx")).toContain(
      "hidden overflow-x-auto md:block",
    );
  });

  test("remaining audited mobile actions expose 44px targets", () => {
    const kds = read("src/app/(app)/kds/kds-board.tsx");
    const pricing = read("src/app/(app)/pricing/pricing-table.tsx");
    const categories = read(
      "src/app/(app)/products/categories/categories-manager.tsx",
    );
    const customerEdit = read(
      "src/app/(app)/customers/[id]/customer-edit.tsx",
    );
    const portal = read("src/app/(app)/customers/[id]/portal-link.tsx");
    const stocktake = read(
      "src/app/(app)/stocktakes/stocktake-actions.tsx",
    );

    expect(kds.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(pricing.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(4);
    expect(categories.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(5);
    expect(customerEdit).toContain("min-h-11 min-w-11");
    expect(portal).toContain("min-h-11");
    expect(stocktake).toContain("min-h-11");
  });
});

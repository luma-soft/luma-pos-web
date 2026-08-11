import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

type PairedSurface = {
  path: string;
  marker: string;
  fields: string[];
  breakpoint?: "md" | "lg";
};

const pairedSurfaces: PairedSurface[] = [
  {
    path: "src/app/(app)/orders/[id]/order-detail-panel.tsx",
    marker: "order-payments",
    fields: [
      "payment.method",
      "payment.createdAt",
      "payment.amount",
      "payment.reference",
      "payment.note",
    ],
  },
  {
    path: "src/app/(app)/orders/[id]/order-detail-panel.tsx",
    marker: "order-returns",
    fields: [
      "row.code",
      "row.createdAt",
      "row.totalRefund",
      "row.reason",
      "row.refundMethod",
    ],
  },
  {
    path: "src/app/(app)/sales/tabs/return-detail-panel.tsx",
    marker: "sales-return-items",
    fields: [
      "item.productName",
      "item.quantity",
      "item.unitName",
      "item.unitPrice",
      "item.total",
      "item.restock",
    ],
  },
  {
    path: "src/app/(app)/online-sales/page.tsx",
    marker: "online-listings",
    fields: [
      "row.productId",
      "row.productName",
      "row.sku",
      "row.status",
      "row.price",
      "row.stock",
      "row.externalItemId",
      "row.lastSyncAt",
      "row.lastError",
    ],
  },
  {
    path: "src/app/(app)/online-sales/page.tsx",
    marker: "online-orders",
    fields: [
      "row.externalOrderSn",
      "row.customerName",
      "row.externalStatus",
      "row.orderId",
      "row.total",
      "row.importedAt",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/purchases-table.tsx",
    marker: "inventory-purchase-items",
    fields: [
      "item.productId",
      "item.productName",
      "item.quantity",
      "item.baseUnit",
      "item.unitCost",
      "item.discount",
      "item.total",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/purchase-returns-table.tsx",
    marker: "inventory-purchase-return-items",
    fields: [
      "item.productId",
      "item.productName",
      "item.sku",
      "item.quantity",
      "item.unitName",
      "item.unitCost",
      "item.returnUnitCost",
      "item.total",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/internal-use-table.tsx",
    marker: "inventory-internal-use-items",
    fields: [
      "item.productName",
      "item.sku",
      "item.quantity",
      "item.unitName",
      "item.unitCost",
      "item.total",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/stock-table.tsx",
    marker: "inventory-stock-location",
    fields: [
      't("products.expand.defaultWarehouse")',
      "formatNumber(stock)",
      "row.baseUnit",
      "formatNumber(min)",
      "<Level row={row}",
      "<StatusBadge sev={sev}",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/stock-actions.tsx",
    marker: "inventory-recent-movements",
    fields: [
      "movement.productName",
      "movement.quantity",
      "movement.baseUnit",
      "movement.type",
      "movement.warehouseName",
      "movement.createdAt",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/products-table.tsx",
    marker: "product-stock-card",
    fields: [
      "<DocumentValue movement={movement}",
      "movement.quantity",
      "movement.createdAt",
      "movement.type",
      "movement.partnerName",
      "movement.stockAfter",
      "movement.transactionPrice",
      "movement.unitCost",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/products-table.tsx",
    marker: "product-stock-location",
    fields: [
      "row.warehouseName",
      "row.quantity",
      "row.reserved",
      "row.minLevel",
      "effectiveActive",
    ],
  },
  {
    path: "src/app/(app)/inventory/tabs/products-table.tsx",
    marker: "product-related",
    fields: [
      "item.id",
      "item.sku",
      "item.name",
      "item.retailPrice",
      "item.costPrice",
      "item.reservedStock",
    ],
  },
  {
    path: "src/app/(app)/partners/tabs/suppliers-table.tsx",
    marker: "supplier-history",
    fields: [
      "row.code",
      "row.createdAt",
      "row.kind",
      "row.itemCount",
      "row.total",
      "<SupplierHistoryStatus row={row}",
    ],
  },
  {
    path: "src/app/(app)/partners/tabs/suppliers-table.tsx",
    marker: "supplier-debt",
    fields: [
      "row.code",
      "row.createdAt",
      "row.kind",
      "row.value",
      "row.balance",
    ],
  },
  {
    path: "src/app/(app)/partners/tabs/customers-table.tsx",
    marker: "customer-sales",
    fields: [
      "row.code",
      "row.orderId",
      "row.status",
      "row.createdAt",
      "row.sellerName",
      "row.total",
      "openOrderPreview",
    ],
  },
  {
    path: "src/app/(app)/partners/tabs/customers-table.tsx",
    marker: "customer-debt",
    fields: [
      "row.code",
      "row.orderId",
      "row.value",
      "row.createdAt",
      "row.typeLabel",
      "row.balance",
      "openOrderPreview",
    ],
  },
  {
    path: "src/app/(app)/partners/tabs/customers-table.tsx",
    marker: "customer-order-preview",
    fields: [
      "item.productName",
      "item.unitName",
      "item.quantity",
      "item.unitPrice",
      "item.discount",
      "item.total",
    ],
  },
  {
    path: "src/app/(app)/settings/import/import-client.tsx",
    marker: "settings-import-preview",
    breakpoint: "md",
    fields: [
      "mappedSample.map",
      "FIELDS.filter",
      "map[f.key]",
      't(`import.fields.${f.key}`)',
    ],
  },
];

function pairedRegions(surface: PairedSurface) {
  const source = read(surface.path);
  const marker = `data-mobile-audit="${surface.marker}"`;
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, `${surface.path} ${surface.marker}`).toBeGreaterThan(-1);
  const afterMarker = source.slice(markerIndex);
  const breakpoint = surface.breakpoint ?? "lg";
  const desktop = afterMarker.match(
    new RegExp(`className="hidden[^"]*${breakpoint}:block"`),
  );
  expect(desktop, `${surface.path} ${surface.marker} desktop pair`).not.toBeNull();
  const desktopIndex = desktop?.index ?? afterMarker.length;
  return {
    mobile: afterMarker.slice(0, desktopIndex),
    desktop: afterMarker.slice(desktopIndex, desktopIndex + 5_000),
  };
}

describe("route-wide mobile responsive audit", () => {
  test("e-invoice mobile row preserves the desktop before-VAT amount", () => {
    const source = readFileSync(
      "src/app/(app)/sales/tabs/einvoices-table.tsx",
      "utf8",
    );
    const mobile = source.slice(
      source.indexOf("renderMobileRow="),
      source.indexOf("renderDetail="),
    );

    expect(source).toContain('key: "beforeVat"');
    expect(mobile).toContain('t("einvoice.cols.beforeVat")');
    expect(mobile).toContain("formatCurrency(Number(row.totalBeforeVat))");
  });

  test("every mobile record surface preserves required business fields beside its desktop table", () => {
    for (const surface of pairedSurfaces) {
      const { mobile, desktop } = pairedRegions(surface);
      for (const field of surface.fields) {
        expect(
          mobile,
          `${surface.path} ${surface.marker} missing ${field}`,
        ).toContain(field);
      }
      expect(desktop, `${surface.path} ${surface.marker} table`).toContain(
        "<table",
      );
    }
  });

  test("same-control editors keep mobile fields and desktop table semantics", () => {
    const product = read("src/app/(app)/products/new/product-form.tsx");
    const settings = read("src/app/(app)/settings/settings-client.tsx");

    expect(product).toContain(
      '<table className="block w-full min-w-0 text-sm lg:table lg:min-w-[860px]">',
    );
    for (const field of [
      "variantChildren.${idx}.variantName",
      "variantChildren.${idx}.sku",
      "variantChildren.${idx}.barcode",
      "variantChildren.${idx}.baseUnit",
      "variantChildren.${idx}.costPrice",
      "variantChildren.${idx}.retailPrice",
      "variantChildren.${idx}.initialStock",
      "variantChildren.${idx}.directSale",
    ]) {
      expect(product).toContain(field);
    }
    expect(product).toContain(
      '<table className="block w-full min-w-0 text-sm lg:table lg:min-w-[640px]">',
    );
    expect(product).toContain("draftRetail");
    expect(product).toContain("draftOverrides");
    expect(product).toContain("applyPriceBooks");

    expect(settings).toContain(
      '<table className="block w-full text-sm md:table">',
    );
    expect(settings).toContain(
      '<tbody className="block md:table-row-group">{staff.map',
    );
    expect(settings).toContain(
      'data-mobile-audit="settings-permissions"',
    );
    expect(settings).toMatch(
      /data-mobile-audit="settings-permissions"[\s\S]*?className="hidden overflow-x-auto md:block"[\s\S]*?<table/,
    );
  });

  test("restock mobile summary and expanded detail preserve desktop days-left semantics", () => {
    const source = read("src/app/(app)/ai/tabs/restock-table.tsx");
    const mobileStart = source.indexOf("renderMobileRow=");
    const detailStart = source.indexOf("renderDetail=");
    const helpersStart = source.indexOf("function Priority");
    expect(mobileStart).toBeGreaterThan(-1);
    expect(detailStart).toBeGreaterThan(mobileStart);
    expect(helpersStart).toBeGreaterThan(detailStart);

    const mobile = source.slice(mobileStart, detailStart);
    const detail = source.slice(detailStart, helpersStart);
    for (const region of [mobile, detail]) {
      expect(region).toContain('label={t("ai.cols.daysLeft")}');
      expect(region).toContain("formatDaysOfStock(row.daysOfStock)");
      expect(region).toContain("daysOfStockTone(row.daysOfStock)");
    }
    expect(source).toContain(
      'render: (row) => formatDaysOfStock(row.daysOfStock)',
    );
    expect(source).toContain(
      'return daysOfStock == null ? "—" : daysOfStock.toFixed(1);',
    );
  });

  test("variant quantity owns the full mobile row and a non-clipping desktop track", () => {
    const source = read("src/app/(app)/products/new/product-form.tsx");
    expect(source).toMatch(
      /<td className="col-span-2 block p-0 lg:table-cell lg:px-3 lg:py-2">\s*<div[^>]*>\{t\("products\.variants\.initialStock"\)\}<\/div>\s*<QuantityInput/,
    );
    expect(source).toContain('className="w-full lg:w-[132px]"');
    expect(source).toContain("touchTargets");
  });

  test("reviewed high-value actions have exact mobile touch contracts", () => {
    const customers = read(
      "src/app/(app)/partners/tabs/customers-table.tsx",
    );
    const suppliers = read(
      "src/app/(app)/partners/tabs/suppliers-table.tsx",
    );
    const online = read("src/app/(app)/online-sales/page.tsx");
    const stock = read("src/app/(app)/inventory/tabs/stock.tsx");
    const listSearchFilter = read("src/components/list-search-filter.tsx");
    const stockActions = read(
      "src/app/(app)/inventory/tabs/stock-actions.tsx",
    );
    const product = read("src/app/(app)/products/new/product-form.tsx");

    expect(customers).toMatch(
      /setCreateOpen\(true\)[\s\S]{0,180}min-h-11/,
    );
    expect(customers).toMatch(
      /href="\/settings\/import"[\s\S]{0,220}min-h-11/,
    );
    expect(customers).toContain(
      "h-10 min-h-11 min-w-11 shrink-0",
    );

    for (const action of ["cancelEditing", "saveSupplier", "startEditing"]) {
      expect(suppliers).toMatch(
        new RegExp(`onClick=\\{${action}\\}[\\s\\S]{0,220}min-h-11`),
      );
    }

    expect(online).toMatch(
      /href=\{tabHref\("inbox"\)\} className="[^"]*min-h-11/,
    );
    expect(online).toMatch(
      /href="\/settings\?tab=shopee" className="[^"]*min-h-11/,
    );
    expect(online).toMatch(
      /href=\{tabHref\("channels"\)\} className="[^"]*min-h-11[^"]*"[\s\S]{0,120}<ShoppingBag/,
    );
    expect(online).toMatch(
      /href=\{tabHref\("channels"\)\} className="[^"]*min-h-11[^"]*"[\s\S]{0,120}<Layers3/,
    );
    expect(online).toMatch(
      /updateMarketplaceShopSyncPolicy[\s\S]*?<button className="[^"]*min-h-11/,
    );
    expect(online).toMatch(
      /href="\/api\/shopee\/connect" className="[^"]*min-h-11/,
    );

    expect(stock).toContain("<ListSearchInput");
    expect(listSearchFilter).toContain("min-h-11 w-full rounded-xl");
    expect(stockActions).toMatch(
      /href=\{Routes\.PurchaseNew\} className="[^"]*min-h-11/,
    );
    expect(product).toMatch(
      /onClick=\{openPriceBooks\}[\s\S]{0,220}min-h-11/,
    );
  });

  test("partner mobile controls avoid inert actions and native horizontal scrollbars", () => {
    const customers = read(
      "src/app/(app)/partners/tabs/customers-table.tsx",
    );
    const suppliers = read(
      "src/app/(app)/partners/tabs/suppliers-table.tsx",
    );
    const toolbarStart = customers.indexOf(
      '<div className="flex shrink-0 flex-wrap items-center gap-2',
    );
    const toolbarEnd = customers.indexOf("</div>", toolbarStart);
    const customerDetailStart = customers.indexOf(
      "function CustomerDetail(",
    );
    const customerDetailEnd = customers.indexOf(
      "function CustomerInfoPanel(",
      customerDetailStart,
    );
    const supplierTabsStart = suppliers.indexOf(
      '<div className="flex shrink-0 items-center gap-6',
    );
    const supplierTabsEnd = suppliers.indexOf(
      "</div>",
      supplierTabsStart,
    );

    expect(toolbarStart).toBeGreaterThan(-1);
    expect(customerDetailStart).toBeGreaterThan(-1);
    expect(supplierTabsStart).toBeGreaterThan(-1);

    const toolbar = customers.slice(toolbarStart, toolbarEnd);
    expect(toolbar).toContain("flex-wrap");
    expect(toolbar).not.toContain("overflow-x-auto");
    expect(toolbar).not.toContain("<ToolbarIcon");

    for (const tabs of [
      customers.slice(customerDetailStart, customerDetailEnd),
      suppliers.slice(supplierTabsStart, supplierTabsEnd),
    ]) {
      expect(tabs).toContain("[scrollbar-width:none]");
      expect(tabs).toContain("[&::-webkit-scrollbar]:hidden");
    }
  });
});

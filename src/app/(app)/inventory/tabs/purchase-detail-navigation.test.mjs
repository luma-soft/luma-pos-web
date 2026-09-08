import { beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let params;
let modal;
let table;
mock.module("next/navigation", () => ({ useSearchParams: () => params }));
mock.module("next-intl", () => ({ useTranslations: () => (key) => key }));
mock.module("@/components/data-table", () => ({
  DataTableShell: (props) => { table = props; return null; },
  RowPreviewModal: (props) => { modal = props; return null; },
}));
mock.module("../../purchases/purchase-cancel-button", () => ({ PurchaseCancelButton: () => null }));
const { PurchasesTable } = await import("./purchases-table.tsx");
const row = { id: "purchase-1", code: "PN001", createdAt: new Date(), status: "received", items: [] };
function render(rows = [row], detailPurchase = null) {
  renderToStaticMarkup(createElement(PurchasesTable, { rows, detailPurchase, printTemplates: [] }));
}
beforeEach(() => { params = new URLSearchParams("tab=purchases&page=2"); });

test("return URL reopens the selected purchase modal", () => {
  params.set("detailPurchaseId", row.id);
  render();
  expect(modal.open).toBe(true);
  expect(modal.title).toBe(row.code);
});

test("return URL opens a purchase outside the current list page", () => {
  params.set("detailPurchaseId", row.id);
  render([], row);
  expect(modal.open).toBe(true);
  expect(modal.title).toBe(row.code);
});

test("opening and closing update the URL while preserving list filters", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { history: { replaceState(_state, _unused, url) { params = new URLSearchParams(url.slice(1)); } } };
  try {
    render();
    expect(modal.open).toBe(false);
    table.onRowClick(row);
    expect(params.get("detailPurchaseId")).toBe(row.id);
    render();
    expect(modal.open).toBe(true);
    modal.onClose();
    render();
    expect(modal.open).toBe(false);
    expect(params.get("page")).toBe("2");
    expect(params.get("tab")).toBe("purchases");
    expect(params.has("detailPurchaseId")).toBe(false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("the desktop supplier column has room for and wraps long supplier names", () => {
  render();
  const supplierColumn = table.columns.find((column) => column.key === "supplier");

  expect(supplierColumn.width).toBe("30%");
  expect(supplierColumn.cellClassName).toContain("whitespace-normal");
  expect(supplierColumn.cellClassName).toContain("break-words");
});

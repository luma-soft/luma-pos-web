import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/actions/price-books", () => ({
  createPriceBook: async () => ({ ok: false }),
  renamePriceBook: async () => ({ ok: false }),
  deletePriceBook: async () => ({ ok: false }),
  setProductPrice: async () => ({ ok: false }),
  applyPriceFormulaAll: async () => ({ ok: false }),
}));

let tableProps;
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh() {} }), usePathname: () => "/inventory", useSearchParams: () => new URLSearchParams(),
}));
mock.module("next-intl", () => ({ useTranslations: () => (key) => key, useLocale: () => "vi" }));
mock.module("@/components/data-table", () => ({
  DataTableShell: (props) => { tableProps = props; return null; },
  stopRowToggle: () => {},
}));

const { PriceBookEditor, PricingMobileRow, PricingTable } = await import("./pricing-table.tsx");

const books = [
  { id: "retail", name: "Giá chung", systemType: "retail", isDefault: true, sortOrder: 0 },
  { id: "cost", name: "Giá vốn", systemType: "cost", isDefault: false, sortOrder: 1 },
  { id: "purchase", name: "Giá nhập cuối", systemType: "purchase", isDefault: false, sortOrder: 2 },
  { id: "list", name: "Giá chưa chiết khấu", systemType: "list", isDefault: false, sortOrder: 3 },
];
const customBook = { id: "trade", name: "Giá thợ", systemType: null, isDefault: false, sortOrder: 4 };
const row = {
  id: "p1", sku: "SP001", name: "Ống nhựa", baseUnit: "m",
  costPrice: 90000, lastPurchase: null,
  prices: { retail: 120000, cost: 90000, purchase: null, list: null, trade: 110000 },
};
const labels = {
  formulaTitle: "Đặt giá theo công thức", belowCost: "Giá bán thấp hơn giá vốn",
  noData: "Chưa có dữ liệu",
};
const noop = () => {};

function editor(book, value = row) {
  return renderToStaticMarkup(createElement(PriceBookEditor, {
    row: value, book, defaultBookId: "retail", saving: false, saved: false,
    labels, onOpenFormula: noop, onChange: noop, onCommit: noop,
  }));
}

describe("pricing table sources and editing", () => {
  test.each(books.filter((book) => ["cost", "purchase"].includes(book.systemType)))("$name exposes no price input or formula action", (book) => {
    const html = editor(book);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });

  test("missing purchase price is explicit and never falls back to retail", () => {
    const html = editor(books[2]);
    expect(html).toContain("Chưa có dữ liệu");
    expect(html).not.toContain("120.000");
  });

  test("a zero purchase price is a valid amount", () => {
    const html = editor(books[2], { ...row, prices: { ...row.prices, purchase: 0 } });
    expect(html).not.toContain("Chưa có dữ liệu");
    expect(html).toContain("0");
  });

  test.each([books[0], books[3], customBook])("$name exposes price and formula editors", (book) => {
    const html = editor(book);
    expect(html).toContain("<input");
    expect(html).toContain("Đặt giá theo công thức");
  });

  test("missing company catalogue price never uses a retail placeholder", () => {
    const html = editor(books[3]);
    expect(html).toContain('placeholder="Chưa có dữ liệu"');
    expect(html).not.toContain("120.000");
  });

  test("custom books keep their retail fallback placeholder", () => {
    const html = editor(customBook, { ...row, prices: { ...row.prices, trade: null } });
    expect(html).toContain('placeholder="120.000');
  });

  test("mobile shows the four fixed sources in the requested order with only catalogue and retail editable", () => {
    const html = renderToStaticMarkup(createElement(PricingMobileRow, {
      row, books, defaultBookId: "retail", savingCell: new Set(), savedCell: new Set(),
      labels: { ...labels, costPrice: "Giá vốn", lastPurchase: "Giá nhập cuối" },
      onOpenFormula: noop, onPriceChange: noop, onPriceCommit: noop,
    }));
    expect(html.match(/>Giá vốn</g)).toHaveLength(1);
    const positions = ["Giá vốn", "Giá nhập cuối", "Giá chưa chiết khấu", "Giá chung"].map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(html).toContain("sau chiết khấu nhà cung cấp");
    expect(html).toContain("Giá niêm yết công ty");
  });

  test("desktop fixes the four system columns before custom books regardless of legacy sort order", () => {
    renderToStaticMarkup(createElement(PricingTable, {
      books: [customBook, ...books], rows: [row], total: 1, canViewPurchasePrices: true,
    }));
    expect(tableProps.columns.map((column) => column.key)).toEqual([
      "product", "book:cost", "book:purchase", "book:list", "book:retail", "book:trade",
    ]);
    expect(tableProps.columns.slice(1, 5).every((column) => column.required && column.defaultVisible)).toBe(true);
    expect(tableProps.columns[5].required).toBe(false);
  });

  test("uses the toolbar book picker without reserving an empty column at the right edge", () => {
    const html = renderToStaticMarkup(createElement(PricingTable, {
      books, rows: [row], total: 1, canViewPurchasePrices: true,
    }));
    expect(html).toContain('aria-haspopup="menu"');
    expect(tableProps.showColumnMenu).toBe(false);
    const dataWidth = tableProps.columns.reduce((sum, column) => sum + parseInt(column.width, 10), 0);
    expect(tableProps.minWidth).toBe(`${dataWidth}px`);
  });
});

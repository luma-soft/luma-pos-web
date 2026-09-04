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

const { PriceBookEditor, PricingMobileRow } = await import("./pricing-table.tsx");

const books = [
  { id: "retail", name: "Giá Chung", systemType: "retail", isDefault: true, sortOrder: 0 },
  { id: "cost", name: "Giá vốn", systemType: "cost", isDefault: false, sortOrder: 1 },
  { id: "purchase", name: "Giá Chưa Chiết Khấu", systemType: "purchase", isDefault: false, sortOrder: 2 },
];
const customBook = { id: "trade", name: "Giá thợ", systemType: null, isDefault: false, sortOrder: 3 };
const row = {
  id: "p1", sku: "SP001", name: "Ống nhựa", baseUnit: "m",
  costPrice: 90000, lastPurchase: null,
  prices: { retail: 120000, cost: 90000, purchase: null, trade: 110000 },
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

describe("automatic price book cells", () => {
  test.each(books)("$name exposes no price input or formula action", (book) => {
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

  test("custom books preserve the price editor and formula action", () => {
    const html = editor(customBook);
    expect(html).toContain("<input");
    expect(html).toContain("Đặt giá theo công thức");
    expect(html).toContain("110.000");
  });

  test("mobile shows each automatic book once with no separate last purchase column", () => {
    const html = renderToStaticMarkup(createElement(PricingMobileRow, {
      row, books, defaultBookId: "retail", savingCell: new Set(), savedCell: new Set(),
      labels: { ...labels, costPrice: "Giá vốn", lastPurchase: "Giá nhập cuối" },
      onOpenFormula: noop, onPriceChange: noop, onPriceCommit: noop,
    }));
    expect(html).not.toContain("Giá nhập cuối");
    expect(html.match(/>Giá vốn</g)).toHaveLength(1);
    expect(html).not.toContain("<input");
  });
});

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

const { PriceBookEditor } = await import("./pricing-table.tsx");
const book = { id: "retail", name: "Giá chung", systemType: "retail", isDefault: true, sortOrder: 3 };
const row = { id: "p1", sku: "SP001", name: "Sản phẩm", baseUnit: "cái", costPrice: 90000, prices: { retail: 100000 } };
const noop = () => {};

function renderEditor(props) {
  return renderToStaticMarkup(createElement(PriceBookEditor, {
    row, book, defaultBookId: "retail", saving: false, saved: false,
    labels: { formulaTitle: "Công thức", belowCost: "Giá dưới vốn", noData: "Chưa có dữ liệu" },
    onOpenFormula: noop, onChange: noop, onCommit: noop, ...props,
  }));
}

for (const mobile of [false, true]) describe(`price status layout (mobile=${mobile})`, () => {
  test.each(["saving", "saved"])("keeps %s inside the input wrapper, away from clipped cell edges and price text", (state) => {
    const html = renderEditor({ mobile, [state]: true });
    const wrapper = html.match(/<div class="relative min-w-0[^"]*">(<input[^>]*\/>)([\s\S]*?)<\/div>/);
    expect(wrapper).not.toBeNull();
    expect(wrapper[1]).toContain("pl-7");
    expect(wrapper[2]).toContain("left-2");
    expect(wrapper[2]).toContain("pointer-events-none");
    expect(wrapper[2]).toContain(state === "saving" ? "animate-spin" : "text-ok");
    expect(wrapper[2]).not.toContain("-right-");
    expect(html).toContain('value="100.000"');
  });

  test("reserves the same text space before, during and after saving", () => {
    const classes = [{}, { saving: true }, { saved: true }].map((status) => {
      const html = renderEditor({ mobile, ...status });
      return html.match(/<input[^>]*class="([^"]+)"/)[1];
    });
    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).toContain("pl-7");
  });

  test("never overlays success on a still-pending save", () => {
    const html = renderEditor({ mobile, saving: true, saved: true });
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("text-ok");
  });
});

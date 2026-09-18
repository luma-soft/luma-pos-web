import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/inventory",
  useRouter: () => ({ push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next-intl", () => ({
  useLocale: () => "vi",
  useTranslations: () => (key) => key,
}));
mock.module("@/components/confirm-dialog-provider", () => ({
  useConfirmDialog: () => ({ confirm: async () => false }),
}));
mock.module("@/lib/actions/products", () => ({
  deleteProduct: async () => ({}),
  setCameraMaterial: async () => ({}),
  setProductActive: async () => ({}),
}));
mock.module("./product-selection", () => ({
  useProductSelection: () => ({
    selectedIds: new Set(), selectedVisibleIds: [], allSelected: false,
    toggle() {}, toggleMany() {}, toggleAll() {},
  }),
}));

const { buildProductUnitOptions, ProductUnitSelector } = await import("./products-table.tsx");

test("unit picker omits duplicate base and alternate-unit names", () => {
  const options = buildProductUnitOptions("cái", [
    { unitName: "cái", multiplier: "1", priceOverride: null },
    { unitName: "hộp", multiplier: "6", priceOverride: null },
    { unitName: "hộp", multiplier: "12", priceOverride: null },
  ]);

  expect(options).toEqual([
    { value: "cái", label: "cái" },
    { value: "hộp", label: "hộp" },
  ]);
});

test("unit picker keeps short unit names on one line", () => {
  const html = renderToStaticMarkup(createElement(ProductUnitSelector, {
    productName: "Gạch Lâm Hưng 30*60",
    baseUnit: "m2",
    units: [{ unitName: "hộp", multiplier: 6, priceOverride: null }],
    value: "m2",
    onChange() {},
  }));

  expect(html).toContain('<span class="block truncate">m2</span>');
  expect(html).not.toContain("whitespace-normal break-words pr-1");
});

test("unit picker renders a plain label when the only definition is the base unit", () => {
  const html = renderToStaticMarkup(createElement(ProductUnitSelector, {
    productName: "Đèn ray LED",
    baseUnit: "cái",
    units: [{ unitName: "cái", multiplier: 1, priceOverride: null }],
    value: "cái",
    onChange() {},
  }));

  expect(html).toContain('<span class="text-slate-500">cái</span>');
  expect(html).not.toContain("aria-label=\"Đơn vị tính Đèn ray LED\"");
});

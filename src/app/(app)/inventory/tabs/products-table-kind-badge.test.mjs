import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/inventory",
  useRouter: () => ({ push() {}, replace() {} }),
  useSearchParams: () => new URLSearchParams("q=64GB"),
}));
mock.module("next-intl", () => ({
  useLocale: () => "vi",
  useTranslations: () => (key) => key === "products.kind.labels.product" ? "Sản phẩm" : key,
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
mock.module("@/components/data-table", () => ({
  stopRowToggle() {},
  DataTableShell: (props) => {
    const productColumn = props.columns.find((column) => column.key === "product");
    return createElement("table", null,
      createElement("tbody", null, props.renderFollowingRows(props.rows[0], [productColumn])),
    );
  },
}));

const { ProductsTable } = await import("./products-table.tsx");

const member = {
  id: "variant-64", sku: "LEXAR-64", name: "Thẻ nhớ Lexar MicroSD - 64GB",
  productKind: "product", variantName: "64GB", isVariantParent: false,
  isActive: true, baseUnit: "cái", costPrice: "0", retailPrice: "355000",
  minCostPrice: "0", maxCostPrice: "0", minRetailPrice: "355000", maxRetailPrice: "355000",
  totalStock: "0", reservedStock: "0", units: [], stockMovements: [], comboItems: [],
};
const root = {
  ...member,
  id: "lexar-group",
  sku: "LEXAR",
  name: "Thẻ nhớ Lexar MicroSD",
  isVariantParent: true,
  variantGroup: {
    id: "lexar-group", name: "Thẻ nhớ Lexar MicroSD", kind: "native",
    count: 1, members: [member], minCostPrice: "0", maxCostPrice: "0",
    minRetailPrice: "355000", maxRetailPrice: "355000", totalStock: "0",
  },
};

test("expanded variant rows keep the product-kind badge", () => {
  const html = renderToStaticMarkup(createElement(ProductsTable, {
    rows: [root], grouped: true, selectionEnabled: false,
  }));

  expect(html).toContain("Thẻ nhớ Lexar MicroSD - 64GB");
  expect(html).toContain(">Sản phẩm</span>");
});

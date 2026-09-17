import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductSearchPicker } from "./product-search-picker.tsx";

describe("ProductSearchPicker", () => {
  test("renders an accessible shared combobox trigger", () => {
    const html = renderToStaticMarkup(createElement(ProductSearchPicker, {
      query: "",
      onQueryChange() {},
      browseItems: [{ id: "one", name: "Sản phẩm" }],
      loadItems: () => [],
      itemKey: (item) => item.id,
      renderItem: (item) => item.name,
      onSelect() {},
      placeholder: "Tìm sản phẩm",
      emptyMessage: "Không tìm thấy sản phẩm",
    }));

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('placeholder="Tìm sản phẩm"');
  });
});

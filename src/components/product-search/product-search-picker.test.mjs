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

  test("exposes selected state to result renderers for POS-style highlighting", async () => {
    const source = await Bun.file(new URL("./product-search-picker.tsx", import.meta.url)).text();
    expect(source).toContain("isItemSelected");
    expect(source).toContain("shouldSelectProductSearchItem");
    expect(source).toContain("selected: boolean");
    expect(source).toContain("selected: isItemSelected?.(item) ?? false");
  });

  test("progressively reveals large result sets", async () => {
    const source = await Bun.file(new URL("./product-search-picker.tsx", import.meta.url)).text();
    expect(source).toContain("visibleCount");
    expect(source).toContain("canLoadMore");
    expect(source).toContain("onScroll=");
    expect(source).not.toContain("loadMoreLabel");
  });
});

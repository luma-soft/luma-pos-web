import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

const { DataTableShell } = await import("./data-table.tsx");
const rows = [{ id: "p1", name: "Ấm siêu tốc", price: 300000 }];
const columns = [
  { key: "product", label: "Sản phẩm", required: true, render: (row) => row.name },
  { key: "price", label: "Giá chung", render: (row) => row.price },
];

function renderTable(props = {}) {
  const html = renderToStaticMarkup(createElement(DataTableShell, {
    tableId: "test.pricing-layout", rows, columns, getRowId: (row) => row.id,
    renderMobileRow: () => null, ...props,
  }));
  return html.match(/<table\b[^>]*>[\s\S]*?<\/table>/)[0];
}

describe("data table utility column", () => {
  test("keeps the column menu and utility column by default", () => {
    const html = renderTable();
    expect(html).toContain('aria-label="Chọn cột hiển thị"');
    expect(html.match(/<col\b/g)).toHaveLength(3);
    expect(html.match(/<th\b/g)).toHaveLength(3);
    expect(html.match(/<td\b/g)).toHaveLength(3);
  });

  test("omits the empty utility column when column selection is handled externally", () => {
    const html = renderTable({ showColumnMenu: false });
    expect(html).not.toContain('aria-label="Chọn cột hiển thị"');
    expect(html.match(/<col\b/g)).toHaveLength(2);
    expect(html.match(/<th\b/g)).toHaveLength(2);
    expect(html.match(/<td\b/g)).toHaveLength(2);
  });

  test("keeps summaries aligned when there is no utility column", () => {
    const html = renderTable({ showColumnMenu: false, summaryCells: [{ key: "price", content: 300000 }] });
    const bodyRows = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g);
    expect(bodyRows).toHaveLength(2);
    for (const row of bodyRows) expect(row.match(/<td\b/g)).toHaveLength(2);
  });

  test("preserves expansion controls and the detail span without a column menu", () => {
    const html = renderTable({
      showColumnMenu: false,
      initialExpandedId: "p1",
      renderExpanded: () => createElement("p", null, "Chi tiết hàng hóa"),
    });
    expect(html).not.toContain('aria-label="Chọn cột hiển thị"');
    expect(html.match(/<col\b/g)).toHaveLength(3);
    expect(html.match(/<th\b/g)).toHaveLength(3);
    expect(html).toContain("lucide-chevron-down");
    expect(html).toContain('colSpan="3"');
  });
});

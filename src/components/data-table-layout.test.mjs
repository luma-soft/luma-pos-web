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

function renderShell(props = {}) {
  return renderToStaticMarkup(createElement(DataTableShell, {
    tableId: "test.pricing-layout", rows, columns, getRowId: (row) => row.id,
    renderMobileRow: () => null, ...props,
  }));
}

function renderTable(props = {}) {
  return renderShell(props).match(/<table\b[^>]*>[\s\S]*?<\/table>/)[0];
}

describe("data table utility column", () => {
  test("keeps the column action outside the table without reserving body cells", () => {
    const shell = renderShell();
    const html = renderTable();
    expect(shell).toContain('aria-label="Chọn cột hiển thị"');
    expect(html).not.toContain('aria-label="Chọn cột hiển thị"');
    expect(html.match(/<col\b/g)).toHaveLength(2);
    expect(html.match(/<th\b/g)).toHaveLength(2);
    expect(html.match(/<td\b/g)).toHaveLength(2);
    expect(html).toContain("pr-14");
  });

  test("omits the empty utility column when column selection is handled externally", () => {
    const html = renderTable({ showColumnMenu: false });
    expect(html).not.toContain('aria-label="Chọn cột hiển thị"');
    expect(html.match(/<col\b/g)).toHaveLength(2);
    expect(html.match(/<th\b/g)).toHaveLength(2);
    expect(html.match(/<td\b/g)).toHaveLength(2);
  });

  test("keeps summaries aligned when there is no utility column", () => {
    const html = renderTable({ summaryCells: [{ key: "price", content: 300000 }] });
    const bodyRows = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g);
    expect(bodyRows).toHaveLength(2);
    for (const row of bodyRows) expect(row.match(/<td\b/g)).toHaveLength(2);
  });

  test("keeps the floating-menu gutter aligned between the last header and values", () => {
    const html = renderTable({
      columns: [
        { key: "product", label: "Sản phẩm", required: true, render: (row) => row.name },
        { key: "price", label: "Tổng bán trừ trả hàng", align: "right", render: (row) => row.price },
      ],
      summaryCells: [{ key: "price", content: "summary" }],
    });
    const header = html.match(/<thead>[\s\S]*?<\/thead>/)[0];
    const valueCell = html.match(/<tbody>[\s\S]*?<td[^>]*>300000<\/td>/)[0];
    const summaryCell = html.match(/<tbody>[\s\S]*?<td[^>]*>summary<\/td>/)[0];
    expect(header).toContain("text-right");
    expect(header).toContain("pr-14");
    expect(valueCell).toContain("pr-14");
    expect(summaryCell).toContain("pr-14");
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

  test("uses only the outer card's bottom radius when embedded below a toolbar", () => {
    const html = renderShell({ embedded: true });
    expect(html).toContain("rounded-b-[inherit]");
    expect(html).not.toContain("rounded-card");
    expect(html).toContain("border-0");
    expect(renderShell()).toContain("rounded-card border");
  });

  test("the floating header action remains available for an empty table", () => {
    const html = renderShell({ rows: [] });
    expect(html).toContain('aria-label="Chọn cột hiển thị"');
    expect(renderTable({ rows: [] }).match(/<th\b/g)).toHaveLength(2);
  });
});

import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

const { DataTableShell, dataTableResultSetKey } = await import("./data-table.tsx");
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

describe("data table scroll reset key", () => {
  test("opening and closing an invoice modal keeps the same list result set", () => {
    const list = "tab=orders&page=3&size=50&q=abc";
    const before = dataTableResultSetKey(new URLSearchParams(list), "expanded");
    const opened = dataTableResultSetKey(new URLSearchParams(list + "&detailOrderId=invoice-1"), "expanded");
    const closed = dataTableResultSetKey(new URLSearchParams(list), "expanded");
    expect(opened).toBe(before);
    expect(closed).toBe(before);
  });

  test("closing customer, supplier, purchase and product modals preserves the list position", () => {
    const base = "tab=products&page=3&size=50&q=abc";
    const before = dataTableResultSetKey(new URLSearchParams(base), "expanded");
    for (const key of [
      "detailCustomerId", "detailSupplierId", "detailPurchaseId",
      "detailProductId", "productModal", "detailTab",
    ]) {
      expect(dataTableResultSetKey(new URLSearchParams(base + `&${key}=some-id`), "expanded")).toBe(before);
    }
    expect(dataTableResultSetKey(new URLSearchParams(base + "&productModal=edit&productId=abc&productKind=product"), "expanded")).toBe(before);
  });

  test("changing a real list filter or page still resets scroll", () => {
    const base = dataTableResultSetKey(new URLSearchParams("tab=orders&page=3&q=abc"), "expanded");
    expect(dataTableResultSetKey(new URLSearchParams("tab=orders&page=4&q=abc"), "expanded")).not.toBe(base);
    expect(dataTableResultSetKey(new URLSearchParams("tab=orders&page=3&q=xyz"), "expanded")).not.toBe(base);
    expect(dataTableResultSetKey(new URLSearchParams("tab=orders&page=3&q=abc&productId=a"), "expanded"))
      .not.toBe(dataTableResultSetKey(new URLSearchParams("tab=orders&page=3&q=abc&productId=b"), "expanded"));
  });

  test("expanding an unrelated row does not reset the underlying table", () => {
    const base = dataTableResultSetKey(new URLSearchParams("tab=returns&page=2"), "expandedReturn");
    const expanded = dataTableResultSetKey(new URLSearchParams("tab=returns&page=2&expandedReturn=return-1&detailOrderId=invoice-1"), "expandedReturn");
    expect(expanded).toBe(base);
  });
});

test("client-owned detail panels open without Next.js navigation, while server-loaded details keep it", () => {
  const source = readFileSync(new URL("./data-table.tsx", import.meta.url), "utf8");
  expect(source).toContain("clientSideDetailNavigation = false");
  expect(source).toContain("if (clientSideDetailNavigation)");
  expect(source).toContain("updateModalUrlQuery({ [expandedParam]: nextId })");
  expect(source).toContain("router.replace(`${pathname}?${sp.toString()}`");
});

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

  test("limits a row action to its configured primary column", () => {
    const shell = renderShell({ renderMobileRow: undefined, onRowClick() {}, rowClickColumnKey: "product" });
    const html = renderTable({ onRowClick() {}, rowClickColumnKey: "product" });
    const mobile = shell.slice(shell.indexOf("lg:hidden"), shell.indexOf("hidden min-h-0 lg:block"));
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    const row = body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/)[0];
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/g);

    expect(mobile.match(/<button\b/g)).toHaveLength(1);
    expect(mobile).toContain("Ấm siêu tốc");
    expect(cells[0]).toContain("<button");
    expect(cells[0]).toContain("Ấm siêu tốc");
    expect(cells[1]).not.toContain("<button");
    expect(row.match(/<tr\b[^>]*>/)[0]).not.toContain("cursor-pointer");
  });

  test("does not make a whole row clickable when no action column is configured", () => {
    const html = renderTable({ onRowClick() {} });
    const shell = renderShell({ renderMobileRow: undefined, onRowClick() {} });
    const mobile = shell.slice(shell.indexOf("lg:hidden"), shell.indexOf("hidden min-h-0 lg:block"));
    const row = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr\b[^>]*>[\s\S]*?<\/tr>/)[0];

    expect(mobile).not.toContain("<button");
    expect(row.match(/<tr\b[^>]*>/)[0]).not.toContain("cursor-pointer");
    expect(row).not.toContain("<button");
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

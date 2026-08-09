import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("suppliers toolbar", () => {
  const tableSource = readFileSync(
    new URL(
      "../src/app/(app)/partners/tabs/suppliers-table.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const tabSource = readFileSync(
    new URL("../src/app/(app)/partners/tabs/suppliers.tsx", import.meta.url),
    "utf8",
  );
  const customerSource = readFileSync(
    new URL("../src/app/(app)/partners/tabs/customers-table.tsx", import.meta.url),
    "utf8",
  );
  const sharedSource = readFileSync(
    new URL("../src/components/list-search-filter.tsx", import.meta.url),
    "utf8",
  );

  test("keeps the shared filter beside search without the supplier total label", () => {
    const toolbar = tableSource.slice(tableSource.indexOf("toolbar={("));

    expect(toolbar).not.toContain('t("suppliers.total", { total })');
    expect(toolbar).toContain("<InstantFilterForm");
    expect(toolbar).toContain("<ListSearchFilterBar");
    expect(toolbar).toContain("<ListSearchInput");
    expect(toolbar).toContain("<FilterTriggerButton");
    expect(toolbar).toContain("<SupplierQuickCreate />");
    expect(toolbar).toContain("sm:flex-row");
  });

  test("customers and suppliers inherit search and filter styling from one component", () => {
    for (const source of [customerSource, tableSource]) {
      expect(source).toContain("<ListSearchFilterBar");
      expect(source).toContain("<ListSearchInput");
      expect(source).toContain("<FilterTriggerButton");
    }
    expect(sharedSource).toContain("min-w-0 flex-1 lg:max-w-xl");
    expect(sharedSource).toContain("min-h-11 w-full rounded-xl");
    expect(sharedSource).toContain("border border-primary-600");
  });

  test("uses a custom debt filter drawer and preserves list query state", () => {
    expect(tableSource).toContain('role="dialog"');
    expect(tableSource).toContain('aria-pressed={draftDebtFilter === value}');
    expect(tableSource).toContain("applyDebtFilter(draftDebtFilter)");
    expect(tableSource).toContain('next.delete("page")');
    expect(tableSource).not.toContain("<select");
    expect(tableSource).not.toContain("<datalist");
  });

  test("passes supplier list state into the client toolbar", () => {
    const tableProps = tabSource.slice(
      tabSource.indexOf("<SuppliersTable"),
      tabSource.indexOf("/>", tabSource.indexOf("<SuppliersTable")),
    );

    expect(tableProps).not.toContain("total={total}");
    expect(tabSource).toContain('query={params.q ?? ""}');
    expect(tabSource).toContain("owing={owing}");
    expect(tabSource).toContain("pageSize={pageSize}");
    expect(tabSource).not.toContain("<Select");
  });
});

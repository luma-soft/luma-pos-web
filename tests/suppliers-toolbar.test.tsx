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

  test("keeps the total, search, filter and create action in one responsive toolbar", () => {
    const toolbar = tableSource.slice(tableSource.indexOf("toolbar={("));

    expect(toolbar).toContain('t("suppliers.total", { total })');
    expect(toolbar).toContain("<InstantFilterForm");
    expect(toolbar).toContain("<SlidersHorizontal");
    expect(toolbar).toContain("<SupplierQuickCreate />");
    expect(toolbar).toContain("sm:flex-row");
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
    expect(tabSource).toContain("total={total}");
    expect(tabSource).toContain('query={params.q ?? ""}');
    expect(tabSource).toContain("owing={owing}");
    expect(tabSource).toContain("pageSize={pageSize}");
    expect(tabSource).not.toContain("<Select");
  });
});

import { readSource } from "../../../../test-support/read-source.mjs";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const ordersDrawer = readFileSync(
  new URL("./orders-filter-drawer.tsx", import.meta.url),
  "utf8",
);
const documentDrawer = readFileSync(
  new URL("./document-filter-drawer.tsx", import.meta.url),
  "utf8",
);

describe("sales filter submission", () => {
  for (const [name, source] of [
    ["orders", ordersDrawer],
    ["quotes, bookings and returns", documentDrawer],
  ]) {
    test(`${name}: applying filters navigates before closing the drawer`, () => {
      expect(source).toContain("onSubmit={applyFilters}");
      expect(source).not.toContain('onSubmit={() => setOpen(false)}');
      expect(source).toContain("router.push(");
    });

    test(`${name}: clear resets the draft instead of merely closing`, () => {
      expect(source).toContain("onClear={clearFilters}");
      expect(readSource("filter-drawer-sections.tsx", import.meta.url)).toContain("onClick={onClear}");
      expect(source).not.toMatch(/onClick=\{closeDrawer\}[\s\S]{0,300}Xóa lọc/);
    });
  }
});

test("quotes count query always sends the quote status the list uses", () => {
  // The list defaults to open quotes while /api/orders/count defaults to "all".
  expect(documentDrawer).toContain('query.set("status", draft.status || "quote")');
});

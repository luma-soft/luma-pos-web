import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const internal = readFileSync(new URL("./internal-use-table.tsx", import.meta.url), "utf8");
const stock = readFileSync(new URL("./stock-table.tsx", import.meta.url), "utf8");
test("mobile internal-use summary expands without dropping authorized actions", () => {
  expect(internal).toContain("renderMobileRow={({ row, toggle })");
  expect(internal).toContain("onClick={toggle}");
  expect(internal).toContain("internalUseReasonLabel(row.reason, locale)");
  expect(internal).toContain('kind="internal-use"');
  expect(internal).toContain("renderDetail={(row) => <ExpandedIssue row={row} />}");
});
test("mobile stock summary opens product detail with stock severity and value", () => {
  expect(stock).toContain("renderMobileRow={({ row })");
  expect(stock).toContain("onClick={() => router.push(Routes.productDetail(row.id)");
  expect(stock).toContain("stockSev(stock, min)");
  expect(stock).toContain("Number(row.stockValue)");
  expect(stock).toContain("renderDetail={(row) => <ExpandedStock row={row} />}");
});

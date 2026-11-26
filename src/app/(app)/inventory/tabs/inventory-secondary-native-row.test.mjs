import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const internal = readSource("./internal-use-table.tsx", import.meta.url);
const internalMobile = readSource("./internal-use-mobile.tsx", import.meta.url);
const stock = readSource("./stock-table.tsx", import.meta.url);
test("mobile internal-use row pushes the detail without dropping authorized actions", () => {
  expect(internal).toContain("onOpen={() => setOpenId(row.id)}");
  expect(internal).toContain("<MobileInternalUseDetail row={openRow} capabilities={capabilities}");
  expect(internalMobile).toContain("internalUseReasonLabel(row.reason, locale)");
  expect(internalMobile).toContain("approveInternalUse(row.id)");
  expect(internalMobile).toContain("deleteInternalUse(row.id)");
  // Desktop keeps the expandable detail and its footer actions.
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

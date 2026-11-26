import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const src = readSource("./cashbook-table.tsx", import.meta.url);
test("cashbook mobile row retains native signed amounts and transaction details", () => {
  expect(src).toContain('renderMobileRow={({ row, toggle })');
  expect(src).toContain("onClick={toggle}");
  expect(src).toContain('row.type === "in" ? "+" : "−"');
  expect(src).toContain('row.counterparty ?? "—"');
  expect(src).toContain("row.status === \"cancelled\"");
  expect(src).toContain("row.note ??");
  expect(src).toContain("renderDetail={(row)");
});

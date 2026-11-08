import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./cashbook-table.tsx", import.meta.url), "utf8");
test("cashbook mobile row retains native signed amounts and transaction details", () => {
  expect(src).toContain('renderMobileRow={({ row, toggle })');
  expect(src).toContain("onClick={toggle}");
  expect(src).toContain('row.type === "in" ? "+" : "−"');
  expect(src).toContain("row.counterparty ?? row.code");
  expect(src).toContain("row.status === \"cancelled\"");
  expect(src).toContain("row.note ??");
  expect(src).toContain("renderDetail={(row)");
});

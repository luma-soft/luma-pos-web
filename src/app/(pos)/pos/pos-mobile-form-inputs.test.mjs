import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./pos-client.tsx", import.meta.url), "utf8");
test("POS mobile editable text fields avoid iPhone Safari zoom", () => {
  expect(src).toContain("min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base");
  expect(src).toContain("min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-base lg:text-sm");
  expect(src).toContain("setOrderNote(e.target.value)");
  expect(src).toContain("setProjectName(e.target.value)");
});

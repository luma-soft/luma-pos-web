import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const input = readFileSync(new URL("./input.tsx", import.meta.url), "utf8");
const select = readFileSync(new URL("./select.tsx", import.meta.url), "utf8");
const date = readFileSync(new URL("./date-input.tsx", import.meta.url), "utf8");
const search = readFileSync(new URL("../list-search-filter.tsx", import.meta.url), "utf8");
test("native iPhone input fonts avoid focus zoom without changing desktop", () => {
  expect(input).toContain("py-2 text-base lg:text-sm transition");
  expect(select).toContain("pr-3 text-base outline-none");
  expect(date).toContain("pr-12 text-base outline-none");
  expect(search).toContain("pr-3 text-base outline-none transition");
  for (const c of [input, select, date, search]) expect(c).toContain("lg:text-sm");
});

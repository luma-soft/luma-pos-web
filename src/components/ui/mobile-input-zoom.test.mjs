import { readSource } from "../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const input = readSource("./input.tsx", import.meta.url);
const select = readSource("./select.tsx", import.meta.url);
const date = readSource("./date-input.tsx", import.meta.url);
const search = readSource("../list-search-filter.tsx", import.meta.url);
test("native iPhone input fonts avoid focus zoom without changing desktop", () => {
  expect(input).toContain("py-2 text-base lg:text-sm transition");
  expect(select).toContain("pr-3 text-base outline-none");
  expect(date).toContain("pr-12 text-base outline-none");
  expect(search).toContain("pr-3 text-base outline-none transition");
  for (const c of [input, select, date, search]) expect(c).toContain("lg:text-sm");
});

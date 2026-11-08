import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./products-table.tsx", import.meta.url), "utf8");
const row = source.slice(source.indexOf("export function ProductMobileRow("), source.indexOf("export function SelectionCheckbox("));

test("native mobile product rows keep image, product, price, stock and unit actions together", () => {
  expect(row).toContain("<ProductThumbnail product={product} largeOnMobile />");
  expect(row).toContain("productDisplayName(product)");
  expect(row).toContain("retailDisplay");
  expect(row).toContain("stockDisplay");
  expect(row).toContain("<ProductUnitSelector");
  expect(row).toContain("onChange={onUnitChange}");
});
test("unit control stays independent of the full-row open hit target", () => {
  expect(row).toContain("onClick={onOpen}");
  expect(row).toContain('className="absolute inset-0');
  expect(row).toContain("pointer-events-auto relative z-10");
  expect(row).toContain("<SelectionCheckbox");
  expect(source).toContain("largeOnMobile = false");
});

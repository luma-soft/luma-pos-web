import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./products-table.tsx",import.meta.url),"utf8");
const start=src.indexOf("export function ProductDetailView(");
const detail=src.slice(start,src.indexOf("function ProductInfoPanel(",start));
test("native product detail tabs are 46px with 3px mobile indicator",()=>{
  expect(detail).toContain("gap-[22px]");
  expect(detail).toContain("min-h-[46px] min-w-11");
  expect(detail).toContain("border-b-[3px]");
  expect(detail).toContain("lg:border-b-2");
  expect(detail).toContain("lg:gap-6");
});
test("information, description, stock, stock card and related features remain",()=>{
  for(const tab of ['"info"','"description"','"stockCard"','"stock"','"related"']) expect(src).toContain(tab);
  expect(detail).toContain("onClick={() => setTab(key)}");
  expect(detail).toContain("disabled={needsVariant && (key === \"stock\" || key === \"stockCard\")}");
});

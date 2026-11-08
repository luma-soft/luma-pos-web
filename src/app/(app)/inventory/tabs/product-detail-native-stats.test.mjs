import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./products-table.tsx",import.meta.url),"utf8");
const panel=src.slice(src.indexOf("function ProductInfoPanel("),src.indexOf("function ProductImageLightbox("));
test("mobile product summary matches the iOS three-metric strip",()=>{
  expect(panel).toContain("grid grid-cols-3 divide-x divide-border-soft");
  expect((panel.match(/<ProductMetric/g)||[]).length).toBe(3);
  for (const name of ["retailPrice","costPrice"]) expect(panel).toContain(`products.pricing.${name}`);
  expect(panel).toContain('label={t("products.stock.current")}');
});
test("minimum stock stays available on mobile and desktop",()=>{
  expect(panel).toContain('className="lg:hidden"');
  expect(panel).toContain('label={t("products.stock.min")}');
  expect(panel).toContain('className="hidden lg:block"');
});

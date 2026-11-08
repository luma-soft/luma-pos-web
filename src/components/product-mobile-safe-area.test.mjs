import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const frame=readFileSync(new URL("./product-modal-frame.tsx",import.meta.url),"utf8");
const products=readFileSync(new URL("../app/(app)/inventory/tabs/products-table.tsx",import.meta.url),"utf8");
const preview=products.slice(products.indexOf("function ProductImageLightbox("),products.indexOf("function ProductDescriptionPanel("));
test("product create and detail modal content clears iPhone status area",()=>{
  expect(frame).toContain("pt-[env(safe-area-inset-top)]");
  expect(frame).toContain("sm:pt-0");
  expect(frame).toContain("sm:h-[min(92dvh,920px)] sm:rounded-2xl");
});
test("product image viewer close and bottom label clear the phone safe areas",()=>{
  expect(preview).toContain("top-[calc(1rem+env(safe-area-inset-top))]");
  expect(preview).toContain("bottom-[calc(1rem+env(safe-area-inset-bottom))]");
  expect(preview).toContain("sm:top-6");
  expect(preview).toContain("sm:bottom-6");
});

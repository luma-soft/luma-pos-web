import { readSource } from "../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const frame=readSource("./product-modal-frame.tsx", import.meta.url);
const products=readSource("../app/(app)/inventory/tabs/products-table.tsx", import.meta.url);
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

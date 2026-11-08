import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./inventory-filter-drawer.tsx",import.meta.url),"utf8");
test("inventory filters use full-screen native mobile geometry with desktop drawer preserved",()=>{
  expect(src).toContain("h-dvh w-full max-w-none");
  expect(src).toContain("lg:h-full lg:max-w-[460px]");
  expect(src).toContain("safe-area-inset-top");
  expect(src).toContain("safe-area-inset-bottom");
  expect(src).toContain("overscroll-contain bg-canvas");
  expect(src).toContain("lg:[&>section]:rounded-none");
});
test("existing filter state and count preview are not bypassed",()=>{
  expect(src).toContain("localCount ? localPreviewCount");
  expect(src).toContain("onClick={reset}");
  expect(src).toContain("onClick={apply}");
  expect(src).toContain("router.replace(`${pathname}?${next.toString()}`, { scroll: false })");
  expect(src).toContain("setOpen(false)");
});

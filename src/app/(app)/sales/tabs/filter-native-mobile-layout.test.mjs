import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const sources = ["orders-filter-drawer.tsx", "document-filter-drawer.tsx"].map((name) => readFileSync(new URL(name, import.meta.url), "utf8"));
test("all invoice filters use iPhone full-screen sheets with desktop drawer restored", () => {
 for (const src of sources) {
  expect(src).toContain('h-[100dvh] w-full max-w-none');
  expect(src).toContain('lg:h-full lg:max-w-md');
  expect(src).toContain("env(safe-area-inset-top)");
  expect(src).toContain("env(safe-area-inset-bottom)");
  expect(src).toContain('overflow-y-auto overscroll-contain');
  expect(src).toContain('lg:px-6 lg:py-5');
  expect(src).toContain("onSubmit={applyFilters}");
 }
});
test("shared nested product/customer picker search avoids zoom on iPhone", () => {
 const picker = readFileSync(new URL("filter-drawer-shared.tsx", import.meta.url), "utf8");
 expect(picker).toContain("pl-9 pr-3 text-base outline-none");
 expect(picker).toContain("lg:h-10 lg:min-h-0 lg:text-sm");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./product-search-picker.tsx",import.meta.url),"utf8");
test("shared product picker keeps iPhone input size and full-size dismiss touch target",()=>{
 expect(src).toContain("pl-10 pr-11 text-base outline-none");
 expect(src).toContain("lg:pr-10 lg:text-sm");
 expect(src).toContain("grid h-11 w-11");
 expect(src).toContain("lg:right-2 lg:h-7 lg:w-7");
});
test("shared offline search and result virtualization semantics are preserved",()=>{
 expect(src).toContain("PRODUCT_SEARCH_DEBOUNCE_MS");
 expect(src).toContain("requestGateRef.current.isLatest(requestId)");
 expect(src).toContain("availableItems.slice(0, visibleCount)");
 expect(src).toContain("role=\"combobox\"");
 expect(src).toContain("renderItem(item, { active, selected })");
});

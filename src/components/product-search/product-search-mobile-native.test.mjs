import { readSource } from "../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const src=readSource("./product-search-picker.tsx", import.meta.url);
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
test("phone picks never summon the keyboard and quantity edits stay in view",()=>{
 const select=src.slice(src.indexOf("function select(item: T"),src.indexOf("function onKeyDown"));
 expect(select).not.toContain("keepSearchFocus");
 expect(src).toContain("flushSync(() => field.blur())");
 expect(src).toContain("onClick={() => select(item)}");
 expect(src.match(/revealFocusedRow\(listRef\.current\)/g)?.length).toBe(2);
});

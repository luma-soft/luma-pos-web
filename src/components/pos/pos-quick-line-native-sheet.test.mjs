import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./pos-quick-line-dialog.tsx",import.meta.url),"utf8");
test("web-only quick line uses iPhone safe-area sheet with desktop dialog retained",()=>{
 expect(src).toContain("lg:items-center lg:p-4");
 expect(src).toContain("env(safe-area-inset-top)");
 expect(src).toContain("env(safe-area-inset-bottom)");
 expect(src).toContain("lg:rounded-2xl lg:py-5");
 expect(src).toContain('window.matchMedia("(min-width: 1024px)")');
 expect(src).toContain("ref={nameInputRef}");
 expect(src).not.toContain("<Input autoFocus");
});
test("quick sale still validates and submits original item fields",()=>{
 expect(src).toContain("onAdd({");
 expect(src).toContain("price == null");
 expect(src).toContain("name: name.trim()");
 expect(src).toContain("unit: unit.trim()");
});

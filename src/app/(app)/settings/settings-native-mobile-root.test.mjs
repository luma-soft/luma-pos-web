import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./settings-client.tsx",import.meta.url),"utf8");
test("native settings root uses existing menu definitions and one settings form tree",()=>{
 expect(src).toContain("mobileSectionSelected");
 expect(src).toContain("visibleNav.map((group)");
 expect(src).toContain("group.items.map((item)");
 expect(src).toContain("onClick={() => pick(item.id)}");
 expect(src).toContain("md:hidden");
 expect(src).toContain('"hidden md:flex"');
 expect(src).toContain("setMobileSectionSelected(false)");
});
test("desktop settings layout and all existing forms remain available",()=>{
 expect(src).toContain("hidden md:flex flex-col");
 expect(src).toContain("active === \"store\" && <StoreSection");
 expect(src).toContain("active === \"payments\" && <PaymentsSection");
 expect(src).toContain("active === \"tax\" && <TaxSection");
 expect(src).toContain('Boolean(normalizedInitialTab)');
});

test("last Mobile settings row remains above the fixed application tab bar",()=>{
 expect(src).toContain("pb-[calc(5rem+env(safe-area-inset-bottom))]");
});

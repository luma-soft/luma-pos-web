import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./settings-client.tsx",import.meta.url),"utf8");
const root=readFileSync(new URL("./settings-mobile-root.tsx",import.meta.url),"utf8");
test("native settings root uses the iOS groups and one settings form tree",()=>{
 expect(src).toContain("mobileSectionSelected");
 expect(src).toContain("<SettingsMobileRoot");
 expect(src).toContain("visibleNav.some((group) => group.items.some((item) => item.id === id))");
 expect(src).toContain("onPick={pick}");
 expect(src).toContain('"hidden lg:flex"');
 expect(src).toContain("setMobileSectionSelected(false)");
 for (const key of ["groupStore","groupDevices","groupQuotes","groupProducts","groupApp"]) expect(root).toContain(`t("${key}")`);
});
test("desktop settings layout and all existing forms remain available",()=>{
 expect(src).toContain("hidden lg:flex flex-col");
 expect(src).toContain("active === \"store\" && <StoreSection");
 expect(src).toContain("active === \"payments\" && <PaymentsSection");
 expect(src).toContain("active === \"tax\" && <TaxSection");
 expect(src).toContain('Boolean(normalizedInitialTab)');
});

test("last Mobile settings row remains above the fixed application tab bar",()=>{
 expect(root).toContain("pb-[calc(5rem+env(safe-area-inset-bottom))]");
});

test("iPad widths below 1024px use Mobile settings navigation rather than Desktop sidebar", () => {
 expect(src).toContain("bg-canvas lg:hidden");
 expect(src).toContain("<SettingsMobileNavBar title=");
 expect(src).toContain('"hidden lg:flex"');
 expect(src).toContain('"hidden lg:block"');
 expect(src).toContain("lg:px-7");
});

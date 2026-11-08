import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./camera-picker-modal.tsx",import.meta.url),"utf8");
test("camera quote picker uses a true iPhone full-screen surface with desktop preserved",()=>{
 expect(src).toContain("h-[100dvh] max-h-[100dvh]");
 expect(src).toContain("lg:h-[min(860px,calc(100dvh-2rem))]");
 expect(src).toContain("lg:max-w-7xl lg:rounded-2xl");
 expect(src).toContain("env(safe-area-inset-top)");
 expect(src).toContain("env(safe-area-inset-bottom)");
});
test("camera quote selection and search still use existing catalog entries",()=>{
 expect(src).toContain("cameras.filter((product)");
 expect(src).toContain("matchesSearchTokens");
 expect(src).toContain("onSelect(product); close();");
 expect(src).toContain("selectedCameras[product.id]");
});

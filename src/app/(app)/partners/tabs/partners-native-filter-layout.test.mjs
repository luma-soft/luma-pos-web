import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const customer=readFileSync(new URL("./customers-table.tsx",import.meta.url),"utf8");
const supplier=readFileSync(new URL("./suppliers-table.tsx",import.meta.url),"utf8");
test("partner filter sheets keep mobile safe-area sizing and desktop width",()=>{
 for(const s of [customer,supplier]){
  expect(s).toContain("h-[100dvh] w-full max-w-none");
  expect(s).toContain("lg:h-full lg:max-w-md");
  expect(s).toContain("env(safe-area-inset-top)");
  expect(s).toContain("env(safe-area-inset-bottom)");
  expect(s).toContain('aria-modal="true"');
 }
});
test("customer filters stay usable when focusing date/money on iPhone",()=>{
 expect(customer).toContain("px-3 text-base min-h-11 lg:min-h-0 lg:text-sm");
 expect(customer).toContain('id="customers-filter-title"');
 expect(customer).toContain("<CustomerFilterForm filters={filters}");
});

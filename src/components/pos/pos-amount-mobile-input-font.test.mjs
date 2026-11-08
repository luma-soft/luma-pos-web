import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const shared=readFileSync(new URL("./pos-summary-controls.tsx",import.meta.url),"utf8");
const pos=readFileSync(new URL("../../app/(pos)/pos/pos-client.tsx",import.meta.url),"utf8");
test("POS discount VAT shipping fields have 16px mobile font, 14px desktop",()=>{
  expect(shared.match(/text-base tabular-nums outline-none lg:text-sm/g)?.length).toBe(2);
  expect(shared).toContain("onValueChange(nextValue ?? 0)");
  expect(shared).toContain("onValueChange: (value: number) => void");
});
test("POS paid amount and price edit inputs stay legible on iPhone",()=>{
  expect(pos).toContain("w-36 rounded-md border border-border bg-surface px-2 py-1 text-right text-base lg:min-h-0 lg:text-sm");
  expect(pos).toContain("w-40 rounded-md border bg-surface px-2 py-1.5 text-right text-base lg:text-sm");
  expect(pos).toContain("setPaidInput(v ?? 0)");
  expect(pos).toContain("onChange={setPrice}");
});

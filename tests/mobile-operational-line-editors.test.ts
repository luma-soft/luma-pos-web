import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const forms = [
  "src/app/(app)/purchases/new/purchase-form.tsx",
  "src/app/(app)/purchase-returns/new/purchase-return-form.tsx",
  "src/app/(app)/inventory/internal-use-form.tsx",
  "src/app/(app)/stocktakes/new/stocktake-form.tsx",
];

describe("mobile operational line editors", () => {
  it.each(forms)("%s gives the 44px quantity control a full-width mobile grid row", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/className="col-span-2 space-y-1 text-xs font-semibold text-slate-500">[\s\S]{0,200}?<QuantityInput[\s\S]{0,300}?touchTargets/);
  });
});

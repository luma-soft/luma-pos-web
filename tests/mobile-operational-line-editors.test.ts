import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const forms = [
  "src/app/(app)/purchases/new/purchase-form.tsx",
  "src/app/(app)/purchase-returns/new/purchase-return-form.tsx",
  "src/app/(app)/inventory/internal-use-form.tsx",
  "src/app/(app)/stocktakes/new/stocktake-form.tsx",
];

const singleScrollForms = forms.slice(0, 3);
const fullHeightShells = [
  "src/app/(app)/purchases/new/purchase-form.tsx",
  "src/app/(app)/purchase-returns/new/purchase-return-form.tsx",
  "src/app/(app)/internal-use/new/page.tsx",
];

describe("mobile operational line editors", () => {
  it.each(forms)("%s gives the 44px quantity control a full-width mobile grid row", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(/className="col-span-2 space-y-1 text-xs font-semibold text-slate-500">[\s\S]{0,200}?<QuantityInput[\s\S]{0,300}?touchTargets/);
  });

  it.each(singleScrollForms)("%s keeps a single scrolling surface on mobile", (file) => {
    const source = readFileSync(file, "utf8");

    expect(source).toMatch(/flex-col lg:flex-row overflow-visible lg:overflow-hidden/);
    expect(source).toMatch(/min-h-\[(?:280|320)px\] overflow-visible[\s\S]{0,100}?lg:overflow-auto/);
  });

  it.each(fullHeightShells)("%s lets the mobile shell grow with its form", (file) => {
    const source = readFileSync(file, "utf8");

    expect(source).toMatch(/min-h-full flex flex-col(?: bg-canvas)? lg:h-dvh/);
  });

  it("keeps internal-use cost read-only and derived from product cost", () => {
    const source = readFileSync(
      "src/app/(app)/inventory/internal-use-form.tsx",
      "utf8",
    );

    expect(source).not.toContain("<NumberInput");
    expect(source).toContain("unitCost: cost");
    expect(source).toContain("unitCost: Math.round(l.costPrice * u.mult)");
    expect(source).toContain("formatCurrency(l.unitCost)");
  });
});

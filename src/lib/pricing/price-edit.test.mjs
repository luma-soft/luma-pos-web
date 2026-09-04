import { expect, test } from "bun:test";
import { formulaPrice, planPriceEdit, pricingUnitPrice, pricingUnitScale } from "./price-edit";

const retail = { isDefault: true, systemType: "retail" };
const list = { systemType: "list" };
const custom = { isDefault: false };
const product = { baseUnit: "m", retailPrice: 200, units: [
  { id: "base", unitName: "m", multiplier: 1, priceOverride: 999 },
  { id: "tree", unitName: "cây", multiplier: 4, priceOverride: 700 },
  { id: "bundle", unitName: "bó", multiplier: 20, priceOverride: null },
] };

test("formula preview matches server precision, null and floor", () => {
  expect(formulaPrice(9999, "-", 20, "pct")).toBe(7999.2);
  expect(formulaPrice(20.15, "-", 50, "pct")).toBe(10.08);
  expect(formulaPrice(20.15, "-", 0.5, "vnd")).toBe(19.65);
  expect(formulaPrice(10000, "-", 20000, "vnd")).toBe(0);
  expect(formulaPrice(null, "+", 10, "vnd")).toBeNull();
  expect(formulaPrice(0, "+", 10, "vnd")).toBe(10);
});

test("retail keep and synchronize preview all units without changing other books", () => {
  const keep = planPriceEdit(product, retail, 200, 250);
  expect(keep.basePrice).toBe(250);
  expect(pricingUnitPrice({ ...product, retailPrice: 250, units: keep.units }, retail, 250, "cây")).toBe(700);
  expect(pricingUnitPrice({ ...product, retailPrice: 250, units: keep.units }, retail, 250, "bó")).toBe(5000);
  const sync = planPriceEdit(product, retail, 200, 493.32, "cây", "sync");
  expect(sync.basePrice).toBe(123.33);
  expect(sync.units.every((unit) => unit.priceOverride === null)).toBe(true);
  expect(pricingUnitPrice({ ...product, retailPrice: 123.33, units: sync.units }, retail, 123.33, "cây")).toBe(493);
});

test("actual base row never overrides or rounds base price", () => {
  expect(pricingUnitPrice(product, retail, 123.33, "m")).toBe(123.33);
  expect(planPriceEdit(product, retail, 200, 123.33, "m").basePrice).toBe(123.33);
});

test("company/custom unit edit uses its own conversion, keeps missing and zero", () => {
  expect(planPriceEdit(product, list, null, 600, "cây").basePrice).toBe(150);
  expect(planPriceEdit(product, custom, 100, 350, "cây").basePrice).toBe(100);
  expect(planPriceEdit(product, list, 150, null).basePrice).toBeNull();
  expect(planPriceEdit(product, list, null, 0).basePrice).toBe(0);
  expect(pricingUnitPrice(product, list, null, "cây")).toBeNull();
  expect(pricingUnitPrice(product, custom, null, "cây")).toBe(700);
});

test("unit inputs normalize to two decimals before conversion like mobile", () => {
  // 40.295 is stored as 40.30 first; dividing by four lands exactly at 10.075.
  expect(planPriceEdit(product, retail, 200, 40.295, "cây", "sync").basePrice).toBe(10.08);
  expect(planPriceEdit(product, list, 200, 40.295, "cây").basePrice).toBe(10.08);
  const customProduct = { ...product, retailPrice: 100, units: [{ unitName: "cây", multiplier: 4, priceOverride: 400 }] };
  expect(planPriceEdit(customProduct, custom, 200, 40.295, "cây").basePrice).toBe(10.08);
});

test("non-invertible custom alternate is readonly; zero retail is not a fake multiplier", () => {
  const zeroRetail = { ...product, retailPrice: 0 };
  expect(pricingUnitScale(zeroRetail, custom, product.units[1])).toBeNull();
  expect(() => planPriceEdit(zeroRetail, custom, 123, 100, "cây")).toThrow();
  expect(planPriceEdit(zeroRetail, custom, 123, 100, "m").basePrice).toBe(100);
  expect(() => planPriceEdit(product, list, 123, null, "cây")).toThrow();
});

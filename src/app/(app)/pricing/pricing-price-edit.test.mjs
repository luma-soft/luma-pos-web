import { describe, expect, test } from "bun:test";
import { canEditPricingUnit, preparePricingPriceEdit, pricingUnitValue, resolvePricingPriceEdit } from "./pricing-price-edit";
import { formulaPrice } from "@/lib/pricing/price-edit";
import { applyUnitPriceChoice, buildUnitPriceReview } from "@/lib/products/unit-price-edit";

const books = [
  { id: "retail", name: "Giá chung", isDefault: true, systemType: "retail" },
  { id: "list", name: "Giá chưa chiết khấu", isDefault: false, systemType: "list" },
  { id: "trade", name: "Giá thợ", isDefault: false },
  { id: "cost", name: "Giá vốn", isDefault: false, systemType: "cost" },
];
const row = { id: "pipe", baseUnit: "m", prices: { retail: 15000, list: 20000, trade: 12000, cost: 11000 }, units: [
  { unitName: "Cây", multiplier: 4, priceOverride: 60000 },
  { unitName: "Bó", multiplier: 20, priceOverride: null },
  { unitName: "Mẫu", multiplier: 0.25, priceOverride: 0 },
] };

describe("pricing cell confirmation", () => {
  test("base-price changes review saved prices and preserve fixed/zero units by default", () => {
    const edit = preparePricingPriceEdit(row, books, "retail", 16000);
    expect(edit.required).toBe(true);
    expect(edit.before.retailPrice).toBe(15000);
    expect(buildUnitPriceReview(edit.before, edit.draft, edit.books).retailRows.map(({ after }) => after)).toEqual([16000, 60000, 320000, 0]);
    const synced = applyUnitPriceChoice(edit.draft, "sync", "base");
    expect(buildUnitPriceReview(edit.before, synced, edit.books).retailRows.map(({ after }) => after)).toEqual([16000, 64000, 320000, 4000]);
    expect(synced.priceBookPrices).toEqual({ list: 20000, trade: 12000 });
  });
  test.each(["list", "trade"])("%s edits require review without retail synchronization", (bookId) => {
    const edit = preparePricingPriceEdit(row, books, bookId, 17000);
    const review = buildUnitPriceReview(edit.before, edit.draft, edit.books);
    expect(edit.required).toBe(true);
    expect(review.canSynchronize).toBe(false);
    expect(review.additionalBooks.map(({ key }) => key)).toEqual([bookId]);
  });
  test("zero and clearing catalogue prices are changes; unchanged normalized prices are not", () => {
    expect(preparePricingPriceEdit(row, books, "retail", 0).required).toBe(true);
    expect(preparePricingPriceEdit(row, books, "list", null).price).toBeNull();
    expect(preparePricingPriceEdit(row, books, "retail", 15000.001)).toBeNull();
  });
  test("single-unit edits save directly and read-only sources never save", () => {
    expect(preparePricingPriceEdit({ ...row, units: [] }, books, "retail", 16000).required).toBe(false);
    expect(preparePricingPriceEdit(row, books, "cost", 12000)).toBeNull();
  });

  test("retail alternate keep updates only its fixed override, including zero and explicit clearing", () => {
    const edit = preparePricingPriceEdit(row, books, "retail", 62500.25, "Cây");
    const saved = resolvePricingPriceEdit(edit);
    expect(saved.payload).toMatchObject({ price: 62500.25, unitName: "Cây", unitPriceMode: "keep" });
    expect(saved.row.prices.retail).toBe(15000);
    expect(saved.row.units.map((unit) => unit.priceOverride)).toEqual([62500.25, null, 0]);
    const zero = resolvePricingPriceEdit(preparePricingPriceEdit(row, books, "retail", 0, "Cây"));
    expect(zero.row.units[0].priceOverride).toBe(0);
    const cleared = resolvePricingPriceEdit(preparePricingPriceEdit(row, books, "retail", null, "Cây"));
    expect(cleared.payload.price).toBeNull();
    expect(cleared.row.units[0].priceOverride).toBeNull();
    expect(cleared.row.units[2].priceOverride).toBe(0);
  });

  test("selected alternate sync uses exact inverse rounding, sends explicit source and clears every fixed override", () => {
    const precise = { ...row, units: [{ id: "tree", unitName: "Cây", multiplier: 2, priceOverride: null }, row.units[2]] };
    const edit = preparePricingPriceEdit(precise, books, "retail", 20.15, "Cây");
    const saved = resolvePricingPriceEdit(edit, "sync", "unit:tree");
    expect(saved.draft.retailPrice).toBe(10.08);
    expect(saved.payload).toMatchObject({ price: 20.15, unitName: "Cây", unitPriceMode: "sync" });
    expect(saved.row.units.every((unit) => unit.priceOverride === null)).toBe(true);
    expect(saved.row.prices.list).toBe(20000);
    expect(saved.row.prices.trade).toBe(12000);
    expect(resolvePricingPriceEdit(edit, "sync", "base").draft.retailPrice).toBe(15000);
  });

  test("custom fixed-unit inverse uses its retail ratio, not physical multiplier", () => {
    const independent = { ...row, units: [{ unitName: "Cây", multiplier: 4, priceOverride: 45000 }] };
    const saved = resolvePricingPriceEdit(preparePricingPriceEdit(independent, books, "trade", 42000, "Cây"));
    expect(saved.row.prices.trade).toBe(14000);
    expect(saved.draft.retailPrice).toBe(15000);
    expect(saved.row.units).toEqual(independent.units);
    expect(pricingUnitValue(saved.row, books[2], "retail", "Cây")).toBe(42000);
    const list = resolvePricingPriceEdit(preparePricingPriceEdit(independent, books, "list", 42000, "Cây"));
    expect(list.row.prices.list).toBe(10500);
  });

  test("zero custom denominator cannot be inverted; list and retail remain editable", () => {
    expect(canEditPricingUnit(row, books[2], "retail", "Mẫu")).toBe(false);
    expect(canEditPricingUnit({ ...row, prices: { ...row.prices, retail: 0 } }, books[2], "retail", "Cây")).toBe(false);
    expect(canEditPricingUnit(row, books[1], "retail", "Mẫu")).toBe(true);
    expect(canEditPricingUnit(row, books[0], "retail", "Mẫu")).toBe(true);
    expect(preparePricingPriceEdit(row, books, "trade", 5000, "Mẫu")).toBeNull();
    expect(() => preparePricingPriceEdit(row, books, "list", null, "Cây")).toThrow();
    expect(resolvePricingPriceEdit(preparePricingPriceEdit(row, books, "trade", null)).row.prices.trade).toBeNull();
  });

  test("concurrency snapshot retains raw custom null and all unit values, never the edited amount", () => {
    const raw = { ...row, prices: { ...row.prices, trade: null } };
    const edit = preparePricingPriceEdit(raw, books, "trade", 35000, "Cây");
    expect(edit.expected).toEqual({ baseUnit: "m", retailPrice: 15000, basePrice: null,
      units: row.units.map(({ unitName, multiplier, priceOverride }) => ({ unitName, multiplier, priceOverride })) });
    expect(resolvePricingPriceEdit(edit).payload.expected).toBe(edit.expected);
    expect(raw.prices.trade).toBeNull();
  });

  test("actual base row is distinct from an alternate with factor one", () => {
    const sameScale = { ...row, units: [{ id: "m", unitName: "m", multiplier: 0.5, priceOverride: 1 }, { unitName: "Mét bán", multiplier: 1, priceOverride: 21.35 }] };
    expect(pricingUnitValue(sameScale, books[0], "retail", "m")).toBe(15000);
    expect(pricingUnitValue(sameScale, books[0], "retail", "Mét bán")).toBe(21.35);
    const edit = preparePricingPriceEdit(sameScale, books, "retail", 20.15, "Mét bán");
    expect(resolvePricingPriceEdit(edit).row.prices.retail).toBe(15000);
    expect(edit.expected.units).toHaveLength(2);
    const review = buildUnitPriceReview(edit.before, resolvePricingPriceEdit(edit).draft, edit.books);
    expect(review.retailRows.map((unit) => unit.unitName)).toEqual(["m", "Mét bán"]);
  });

  test("single-SKU formula is exact to cents and still asks for confirmation", () => {
    const next = formulaPrice(20.15, "-", 50, "pct");
    expect(next).toBe(10.08);
    const edit = preparePricingPriceEdit({ ...row, units: [], prices: { ...row.prices, retail: 20.15 } }, books, "retail", next, "m", true);
    expect(edit.required).toBe(true);
    expect(resolvePricingPriceEdit(edit).payload.price).toBe(10.08);
  });
});

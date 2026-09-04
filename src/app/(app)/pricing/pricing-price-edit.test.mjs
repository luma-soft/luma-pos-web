import { describe, expect, test } from "bun:test";
import { preparePricingPriceEdit } from "./pricing-price-edit";
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
});

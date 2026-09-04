import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyUnitPriceChoice,
  buildUnitPriceReview,
  normalizeUnitPriceDraft,
  type UnitPricingSnapshot,
} from "./unit-price-edit";

const before: UnitPricingSnapshot = {
  baseUnit: "m", retailPrice: 15000, costPrice: 11000,
  priceBookPrices: { company: 14000 },
  units: [
    { id: "tree", unitName: "Cây", multiplier: 4, priceOverride: 60000 },
    { id: "pack", unitName: "Bó", multiplier: 20, priceOverride: null },
  ],
};
const draft = (patch: Partial<UnitPricingSnapshot> = {}) => ({ ...before, ...patch });

describe("multi-unit product price confirmation", () => {
  it("does not prompt or touch prices for a metadata-only edit", () => {
    const next = { ...draft(), name: "Tên mới", description: "Mô tả mới" };
    assert.equal(buildUnitPriceReview(before, next).required, false);
    assert.deepEqual(applyUnitPriceChoice(next, "keep"), next);
  });

  it("base-price edits preview fixed and linked units independently", () => {
    const next = draft({ retailPrice: 16000 });
    const review = buildUnitPriceReview(before, next);
    assert.equal(review.required, true);
    assert.equal(review.canSynchronize, true);
    assert.equal(review.suggestedSource, "base");
    assert.deepEqual(review.retailRows.map((row) => [row.unitName, row.before, row.after, row.mode]), [
      ["m", 15000, 16000, "base"], ["Cây", 60000, 60000, "fixed"], ["Bó", 300000, 320000, "linked"],
    ]);
    const synced = applyUnitPriceChoice(next, "sync", "base");
    assert.equal(synced.retailPrice, 16000);
    assert.ok(synced.units.every((unit) => unit.priceOverride === null));
    assert.equal(buildUnitPriceReview(before, synced).retailRows[1].after, 64000);
    assert.deepEqual(synced.priceBookPrices, before.priceBookPrices);
  });

  it("supports reverse conversion from an edited alternate price", () => {
    const next = draft({ units: [{ ...before.units[0], priceOverride: 64000 }, before.units[1]] });
    const review = buildUnitPriceReview(before, next);
    assert.equal(review.suggestedSource, "unit:tree");
    const synced = applyUnitPriceChoice(next, "sync", review.suggestedSource!);
    assert.equal(synced.retailPrice, 16000);
    assert.equal(synced.units[0].id, "tree");
    assert.equal(synced.units[1].priceOverride, null);
    assert.equal(applyUnitPriceChoice(next, "keep").units[0].priceOverride, 64000);
  });

  it("requires an explicit source when entered prices conflict", () => {
    const next = draft({ retailPrice: 16000, units: [{ ...before.units[0], priceOverride: 68000 }, before.units[1]] });
    const review = buildUnitPriceReview(before, next);
    assert.equal(review.suggestedSource, null);
    assert.throws(() => applyUnitPriceChoice(next, "sync"), /source/i);
    assert.equal(applyUnitPriceChoice(next, "sync", "base").retailPrice, 16000);
    assert.equal(applyUnitPriceChoice(next, "sync", "unit:tree").retailPrice, 17000);
  });

  it("zero is an explicit price, clearing an override restores conversion", () => {
    const free = draft({ units: [{ ...before.units[0], priceOverride: 0 }, before.units[1]] });
    assert.equal(buildUnitPriceReview(before, free).retailRows[1].after, 0);
    assert.equal(applyUnitPriceChoice(free, "sync", "unit:tree").retailPrice, 0);
    const linked = draft({ units: [{ ...before.units[0], priceOverride: null }, before.units[1]] });
    assert.equal(buildUnitPriceReview(before, linked).required, true);
    assert.equal(buildUnitPriceReview(before, linked).retailRows[1].mode, "linked");
  });

  it("preserves fractional factors and rounds the normalized base to cents", () => {
    const next = draft({ units: [{ id: "tree", unitName: "Cây", multiplier: 2.5, priceOverride: 100.01 }] });
    const synced = applyUnitPriceChoice(next, "sync", "unit:tree");
    assert.equal(synced.retailPrice, 40);
    assert.equal(synced.units[0].multiplier, 2.5);
    assert.equal(buildUnitPriceReview(before, next).required, true);
  });

  it("cost/book-only changes do not offer to discard retail overrides", () => {
    const next = draft({ costPrice: 12000, priceBookPrices: { company: 0 } });
    const review = buildUnitPriceReview(before, next);
    assert.equal(review.required, true);
    assert.equal(review.canSynchronize, false);
    assert.deepEqual(review.additionalBooks.map((book) => [book.key, book.rows[1].before, book.rows[1].after]), [
      ["cost", 44000, 48000], ["company", 56000, 0],
    ]);
    assert.equal(applyUnitPriceChoice(next, "keep").units[0].priceOverride, 60000);
  });

  it("missing book prices remain missing, never zero or retail fallback", () => {
    const next = draft({ priceBookPrices: { company: null } });
    assert.equal(buildUnitPriceReview(before, next).additionalBooks[0].rows[1].after, null);
  });

  it("detects factor-only edits and unit deletion, ignores redundant base rows", () => {
    assert.equal(buildUnitPriceReview(before, draft({ units: [{ ...before.units[0], multiplier: 4.5 }, before.units[1]] })).required, true);
    const removed = buildUnitPriceReview(before, draft({ units: [] }));
    assert.equal(removed.required, true);
    assert.equal(removed.retailRows.find((row) => row.unitName === "Cây")?.after, null);
    const duplicateBase = draft({ units: [{ unitName: "m", multiplier: 1, priceOverride: null }, ...before.units] });
    assert.equal(buildUnitPriceReview(before, duplicateBase).required, false);
  });

  it("single-unit price edits need no multi-unit confirmation", () => {
    const simple = draft({ units: [] });
    assert.equal(buildUnitPriceReview(simple, { ...simple, retailPrice: 16000 }).required, false);
  });

  it("reviews and saves the same money/factor precision as storage", () => {
    const next = draft({ retailPrice: 100.124, units: [{ unitName: "Cây", multiplier: 100.00004, priceOverride: null }] });
    const normalized = normalizeUnitPriceDraft(next);
    assert.equal(normalized.retailPrice, 100.12);
    assert.equal(normalized.units[0].multiplier, 100);
    assert.equal(buildUnitPriceReview(before, next).retailRows[1].after, 10012);
    assert.deepEqual(applyUnitPriceChoice(next, "keep"), normalized);
    assert.throws(() => normalizeUnitPriceDraft(draft({ units: [{ unitName: "Cây", multiplier: 0.00001 }] })), /0,0001/);
  });

  it("includes custom books with no override that inherit retail", () => {
    const next = draft({ retailPrice: 16000 });
    const review = buildUnitPriceReview(before, next, [{ key: "trade", label: "Giá thợ", kind: "custom" }]);
    const inherited = review.additionalBooks.find((book) => book.key === "trade");
    assert.ok(inherited);
    assert.equal(inherited.rows[0].after, 16000);
    assert.equal(inherited.rows[1].after, 60000);
    const sync = buildUnitPriceReview(before, applyUnitPriceChoice(next, "sync", "base"), [{ key: "trade", label: "Giá thợ", kind: "custom" }]);
    assert.equal(sync.additionalBooks.find((book) => book.key === "trade")?.rows[1].after, 64000);
  });
});

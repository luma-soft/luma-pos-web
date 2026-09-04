import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approvePriceBookSwitch, prepareInvoicePriceBookSwitch, prepareLinePriceBookSwitch, selectedPosUnitPrice } from "./price-book-switch";
import { createLinePriceEditorState } from "./line-price-editor";

const books = [
  { id: "retail", isDefault: true, systemType: "retail" as const },
  { id: "trade", systemType: null },
  { id: "list", systemType: "list" as const },
];
const product = {
  baseUnit: "m", retailPrice: "10000.25", prices: { trade: "12345.67", list: "0" },
  units: [
    { unitName: "m", multiplier: "1", priceOverride: "99999" },
    { unitName: "cây", multiplier: "4", priceOverride: null },
    { unitName: "đoạn", multiplier: "1", priceOverride: "15000" },
  ],
};
const line = { key: "one", product, unitName: "m", unitPrice: 10000.25, quantity: 3, note: "Keep note" };

describe("POS price-book switching", () => {
  it("invoice switching preserves base decimals and ignores a redundant base override", () => {
    const result = prepareInvoicePriceBookSwitch([line], "trade", books);
    assert.ok(result);
    assert.equal(result.lines[0].unitPrice, 12345.67);
    assert.equal(result.lines[0].quantity, 3);
    assert.equal(result.lines[0].note, "Keep note");
  });

  it("per-line switching also preserves base decimals", () => {
    const result = prepareLinePriceBookSwitch(line, "trade", createLinePriceEditorState(line.unitPrice, 0), books);
    assert.ok(result);
    assert.equal(result.nextPrice, 12345.67);
    assert.equal(result.editor.price, "12345.67");
  });

  it("an actual alternate unit with multiplier one retains its own override", () => {
    assert.equal(selectedPosUnitPrice(product, "đoạn", "", books), 15000);
    assert.equal(selectedPosUnitPrice(product, "cây", "trade", books), 49383);
  });

  it("a redundant base row without an override never rounds decimals, unlike a genuine alternate x1", () => {
    const plain = { ...product, units: product.units.map((unit) => ({ ...unit, priceOverride: null })) };
    assert.equal(selectedPosUnitPrice(plain, "m", "trade", books), 12345.67);
    assert.equal(selectedPosUnitPrice(plain, "đoạn", "trade", books), 12346);
  });

  it("invoice switching keeps manual prices and discounts but resets nonmanual discounts", () => {
    const manual = { ...line, key: "manual", manualPrice: true, unitPrice: 70000, lineDiscount: 14000, lineDiscountMode: "pct" as const, lineDiscountValue: 20, priceBook: "retail" };
    const automatic = { ...line, lineDiscount: 2000, lineDiscountMode: "pct" as const, lineDiscountValue: 20, priceBook: "retail" };
    const cart = [manual, automatic];
    const snapshot = structuredClone(cart);
    const result = prepareInvoicePriceBookSwitch(cart, "trade", books);
    assert.ok(result);
    assert.deepEqual(result.lines[0], { ...manual, priceBook: undefined, freeRestore: undefined });
    assert.equal(result.lines[1].unitPrice, 12345.67);
    assert.equal(result.lines[1].lineDiscount, 0);
    assert.equal(result.lines[1].lineDiscountValue, 0);
    assert.equal(result.lines[1].lineDiscountMode, "vnd");
    assert.equal(result.lines[1].priceBook, undefined);
    assert.equal(result.preservedManualCount, 1);
    assert.equal(result.clearedDiscountCount, 1);
    assert.deepEqual(cart, snapshot);
  });

  it("per-line switching resets the manual price and percentage discount", () => {
    const result = prepareLinePriceBookSwitch(line, "trade", createLinePriceEditorState(70000, 14000, "pct", 20), books);
    assert.ok(result);
    assert.deepEqual(result.editor, createLinePriceEditorState(12345.67, 0));
    assert.equal(result.previous.sellPrice, 56000);
  });

  it("invoice switching preserves free lines while repricing their restoration state", () => {
    const free = { ...line, manualPrice: true, unitPrice: 0, freeRestore: { unitPrice: 70000, lineDiscount: 14000, lineDiscountMode: "pct" as const, lineDiscountValue: 20, priceBook: "retail" } };
    const result = prepareInvoicePriceBookSwitch([free], "trade", books);
    assert.ok(result);
    assert.equal(result.lines[0].unitPrice, 0);
    assert.deepEqual(result.lines[0].freeRestore, { unitPrice: 12345.67, lineDiscount: 0, priceBook: undefined });
  });

  it("a missing or unauthorized source rejects the entire switch without changing the original cart", () => {
    const missing = { ...line, key: "missing", product: { ...product, prices: { trade: "12345.67", list: null } } };
    const cart = [line, missing];
    const snapshot = structuredClone(cart);
    assert.equal(prepareInvoicePriceBookSwitch(cart, "list", books), null);
    assert.equal(prepareInvoicePriceBookSwitch(cart, "list", [books[0]]), null);
    assert.equal(prepareLinePriceBookSwitch(missing, "list", createLinePriceEditorState(10000, 0), books), null);
    assert.deepEqual(cart, snapshot);
  });

  it("a valid zero source is not treated as missing", () => {
    const result = prepareInvoicePriceBookSwitch([line], "list", books);
    assert.ok(result);
    assert.equal(result.lines[0].unitPrice, 0);
  });

  it("cancelled confirmation never commits and acceptance commits only afterwards", async () => {
    let commits = 0;
    const options = { value: [line], needsConfirmation: true, isCurrent: () => true, commit: () => { commits += 1; } };
    assert.equal(await approvePriceBookSwitch({ ...options, confirm: async () => false }), "cancelled");
    assert.equal(commits, 0);
    assert.equal(await approvePriceBookSwitch({ ...options, confirm: async () => { assert.equal(commits, 0); return true; } }), "applied");
    assert.equal(commits, 1);
  });

  it("approval cannot overwrite cart edits made while the confirmation was open", async () => {
    let commits = 0;
    const outcome = await approvePriceBookSwitch({ value: [line], needsConfirmation: true, confirm: async () => true, isCurrent: () => false, commit: () => { commits += 1; } });
    assert.equal(outcome, "stale");
    assert.equal(commits, 0);
  });
});

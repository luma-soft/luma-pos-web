import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildVariantCombinations, reconcileVariantRows, validateVariantSubmission, variantCombinationBudget } from "./variant-model";
const versions = [{ attributeId: "version", name: "Phiên bản", values: ["E", "F"], valueIds: ["e", "f"], createsVariants: true }];
describe("variant contract", () => {
  test("E/F and 3 by 3 generate exact combinations; specifications do not", () => {
    assert.equal(buildVariantCombinations(versions).length, 2);
    assert.equal(buildVariantCombinations([{ name: "SIZE", values: ["1", "2", "3"] }, { name: "Weight", values: ["2", "3", "5"] }]).length, 9);
    assert.equal(buildVariantCombinations([...versions, { name: "Band", values: ["2.4", "5"], createsVariants: false }]).length, 2);
    assert.deepEqual(buildVariantCombinations([{ name: "SSID", values: ["8"], createsVariants: false }]), []);
  });
  test("identity survives rename and axis reorder without losing SKU price or stock", () => {
    const axes = [...versions, { attributeId: "size", name: "Size", values: ["L"], valueIds: ["large"] }];
    const rows = buildVariantCombinations(axes).map((c, i) => ({ ...c, sku: `RAP-${i}`, cost: i ? 990000 : 1280000, stock: i ? 2 : 0 }));
    const renamed = [{ ...axes[1], name: "Kích thước" }, { ...axes[0], values: ["Enterprise", "Fast"] }];
    const merged = reconcileVariantRows(buildVariantCombinations(renamed), rows, (combo) => ({ ...combo, sku: "", cost: 0, stock: 0 }));
    assert.deepEqual(merged.map(({ sku, cost, stock }) => ({ sku, cost, stock })), [{ sku: "RAP-0", cost: 1280000, stock: 0 }, { sku: "RAP-1", cost: 990000, stock: 2 }]);
  });
  test("delimiter in a display value never merges two SKUs", () => {
    const rows = buildVariantCombinations([{ name: "A", values: ["A / B", "A"] }, { name: "B", values: ["C", "B / C"] }]);
    assert.equal(new Set(rows.map((r) => r.combinationKey)).size, 4);
  });
  test("rejects foreign, duplicate, missing and stale combination payloads", () => {
    const rows = buildVariantCombinations(versions);
    assert.throws(() => validateVariantSubmission({ attributes: versions, children: [] }));
    assert.throws(() => validateVariantSubmission({ attributes: versions, children: [rows[0], rows[0]] }));
    assert.throws(() => validateVariantSubmission({ attributes: versions, children: [{ specs: { "Phiên bản": ["G"] } }, rows[1]] }));
    assert.throws(() => validateVariantSubmission({ attributes: versions, children: [{ ...rows[0], specs: rows[1].specs }, rows[1]] }));
  });
  test("explicit exclusions permitted and existing SKUs cannot receive opening stock again", () => {
    const rows = buildVariantCombinations(versions);
    assert.equal(validateVariantSubmission({ attributes: versions, children: [rows[0]], excludedCombinationKeys: [rows[1].combinationKey] }).length, 1);
    assert.throws(() => validateVariantSubmission({ attributes: versions, children: [{ ...rows[0], productId: "old", initialStock: 2 }, rows[1]] }));
  });
  test("rejects duplicates after whitespace/case normalization and caps product count before expansion", () => {
    assert.throws(() => buildVariantCombinations([{ name: "Size", values: ["E", " e "] }]));
    assert.throws(() => buildVariantCombinations([{ name: "Size", values: Array.from({ length: 201 }, (_, n) => String(n)) }]));
  });
  test("existing groups over 200 retain their combinations within a bounded addition budget", () => {
    const existingAxes = [{ name: "Model", values: Array.from({ length: 236 }, (_, i) => String(i)) }];
    const budget = variantCombinationBudget(236, 0);
    const existing = buildVariantCombinations(existingAxes, { maxCombinations: budget });
    assert.equal(validateVariantSubmission({ attributes: existingAxes, children: existing, maxCombinations: budget }).length, 236);
    assert.equal(buildVariantCombinations([{ name: "Model", values: Array.from({ length: 436 }, (_, i) => String(i)) }], { maxCombinations: budget }).length, 436);
    assert.throws(() => buildVariantCombinations([{ name: "Model", values: Array.from({ length: 437 }, (_, i) => String(i)) }], { maxCombinations: budget }), /tooMany/);
    assert.throws(() => buildVariantCombinations(existingAxes), /tooMany/);
  });
});

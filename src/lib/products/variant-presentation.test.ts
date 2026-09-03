import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { matchesProductVariant, productVariantLabel, selectableProductIds } from "./variant-presentation";

describe("variant presentation", () => {
  const e = { id: "e", name: "Ruijie RAP2200", sku: "RG-RAP2200(E)", specs: { "Phiên bản": ["E"], __orderNote: ["private"] } };
  const f = { ...e, id: "f", sku: "RG-RAP2200(F)", specs: { "Phiên bản": ["F"] } };

  test("compact labels use distinguishing attributes without internal notes", () => {
    assert.equal(productVariantLabel(e), "E");
    assert.equal(productVariantLabel({ ...e, variantName: "Bản E" }), "Bản E");
  });

  test("search locates SKU or Vietnamese attribute across words", () => {
    assert.equal(matchesProductVariant(f, "RAP2200(F)"), true);
    assert.equal(matchesProductVariant(f, "phien ban F"), true);
    assert.equal(matchesProductVariant(e, "RAP2200(F)"), false);
    assert.equal(matchesProductVariant(e, "private"), false);
    assert.equal(matchesProductVariant(e, "F", { includeProductName: false }), false);
    assert.equal(matchesProductVariant(f, "F", { includeProductName: false }), true);
  });

  test("group selection excludes synthetic parent and deduplicates real imported root", () => {
    assert.deepEqual(selectableProductIds({ id: "parent", isVariantParent: true, variantGroup: { members: [e, f] } }), ["e", "f"]);
    assert.deepEqual(selectableProductIds({ ...e, variantGroup: { members: [e, e, f] } }), ["e", "f"]);
    assert.deepEqual(selectableProductIds({ id: "parent", isVariantParent: true }), []);
    assert.deepEqual(selectableProductIds({ ...e, variantGroup: { members: [e, f] } }, false), ["e"]);
  });
});

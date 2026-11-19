import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { matchesProductVariant, productDisplayName, productLineDisplayName, productVariantLabel, productVariantValues, selectableProductIds } from "./variant-presentation";

describe("variant presentation", () => {
  const e = { id: "e", name: "Ruijie RAP2200", sku: "RG-RAP2200(E)", specs: { "Phiên bản": ["E"], __orderNote: ["private"] } };
  const f = { ...e, id: "f", sku: "RG-RAP2200(F)", specs: { "Phiên bản": ["F"] } };

  test("compact labels use distinguishing attributes without internal notes", () => {
    assert.equal(productVariantLabel(e), "E");
    assert.equal(productVariantLabel({ ...e, variantName: "Bản E" }), "Bản E");
  });

  test("product items show every distinguishing attribute once", () => {
    const tile = { ...e, variantName: "34601", specs: { "Mã": ["34601"], "Đơn vị": ["m2"], __orderNote: ["private"] } };
    assert.deepEqual(productVariantValues(tile), ["34601", "m2"]);
    assert.equal(productDisplayName(tile), "Ruijie RAP2200 · 34601 · m2");
    assert.equal(productDisplayName({ ...tile, name: "Ruijie RAP2200 34601" }), "Ruijie RAP2200 34601 · m2");
  });

  test("composite variant labels do not repeat their individual attribute values", () => {
    const product = {
      ...e,
      name: "Ống Nhựa PVC Tiền Phong",
      variantName: "140 / C2",
      specs: { SIZE: ["140"], "LOẠI ỐNG": ["C2"], "Đơn vị": ["m2"] },
    };
    assert.equal(productDisplayName(product), "Ống Nhựa PVC Tiền Phong · 140 / C2 · m2");
  });

  test("document names retain public attributes and support older snapshots", () => {
    assert.equal(productLineDisplayName({ productName: "Ống PVC - 110", productVariantName: "110", productSpecs: { "Cấp": ["C2"], __orderNote: ["private"] } }), "Ống PVC - 110 · C2");
    assert.equal(productLineDisplayName({ productName: "Ống PVC" }), "Ống PVC");
  });

  test("search locates SKU or Vietnamese attribute across words", () => {
    assert.equal(matchesProductVariant(f, "RAP2200(F)"), true);
    assert.equal(matchesProductVariant(f, "phien ban F"), true);
    assert.equal(matchesProductVariant(e, "RAP2200(F)"), false);
    assert.equal(matchesProductVariant(e, "private"), false);
    assert.equal(matchesProductVariant(e, "F", { includeProductName: false }), false);
    assert.equal(matchesProductVariant(f, "F", { includeProductName: false }), true);
  });

  test("variant search includes base and alternate unit identifiers", () => {
    const product = {
      ...e,
      baseUnit: "m",
      unitDefinitions: [{ unitName: "Cây", sku: "PIPE-CANE", barcode: "CANE-001" }],
    };
    assert.equal(matchesProductVariant(product, "Ruijie Cây"), true);
    assert.equal(matchesProductVariant(product, "PIPE-CANE"), true);
    assert.equal(matchesProductVariant(product, "CANE-001"), true);
    assert.equal(matchesProductVariant(product, "m"), true);
  });

  test("group selection excludes synthetic parent and deduplicates real imported root", () => {
    assert.deepEqual(selectableProductIds({ id: "parent", isVariantParent: true, variantGroup: { members: [e, f] } }), ["e", "f"]);
    assert.deepEqual(selectableProductIds({ ...e, variantGroup: { members: [e, e, f] } }), ["e", "f"]);
    assert.deepEqual(selectableProductIds({ id: "parent", isVariantParent: true }), []);
    assert.deepEqual(selectableProductIds({ ...e, variantGroup: { members: [e, f] } }, false), ["e"]);
  });
});

describe("variant group summaries", () => {
  test("orders option values naturally", async () => {
    const { compareVariantValues, sortVariantMembers } = await import("./variant-presentation");
    assert.deepEqual(["512GB", "64GB", "32GB"].sort(compareVariantValues), ["32GB", "64GB", "512GB"]);
    const members = ["10", "2", "21"].map((value, index) => ({ id: `p${index}`, sku: `SP${9 - index}`, name: "Ống", specs: { SIZE: [value] } }));
    assert.deepEqual(sortVariantMembers(members).map((member) => member.specs.SIZE[0]), ["2", "10", "21"]);
  });

  test("price range ignores unpriced SKUs unless all are unpriced", async () => {
    const { variantPriceRange, formatVariantPriceRange } = await import("./variant-presentation");
    assert.deepEqual(variantPriceRange(["0", "135000", "280000.00"]), { min: 135000, max: 280000 });
    assert.deepEqual(variantPriceRange(["0", "0"]), { min: 0, max: 0 });
    assert.match(formatVariantPriceRange(135000, 280000), /^135\.000 – 280\.000/);
    assert.equal(formatVariantPriceRange(5000, 5000).includes("–"), false);
  });

  test("summarizes attribute values per axis", async () => {
    const { variantOptionSummary, formatVariantOptionSummary } = await import("./variant-presentation");
    const summary = variantOptionSummary([
      { specs: { "Dung Lượng": ["64GB"] } }, { specs: { "Dung Lượng": ["512GB"] } },
      { specs: { "Dung Lượng": ["32GB"] } }, { specs: { "Dung Lượng": ["128GB"] }, variantName: null },
      { specs: { "Dung Lượng": ["256GB"], __orderNote: "x" } },
    ]);
    assert.deepEqual(summary, [{ name: "Dung Lượng", values: ["32GB", "64GB", "128GB", "256GB", "512GB"] }]);
    assert.equal(formatVariantOptionSummary(summary, 3), "Dung Lượng: 32GB · 64GB · 128GB +2");
    assert.equal(formatVariantOptionSummary(summary, 3, { compact: true }), "32GB · 64GB · 128GB +2");
  });
});

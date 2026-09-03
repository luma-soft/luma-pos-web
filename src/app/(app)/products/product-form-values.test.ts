import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProductDetail } from "@/lib/data/products";
import { createProductSchema } from "./new/schema";
import { productToFormInitialValues, resolveProductFormSeed } from "./product-form-values";

const base = {
  id: "parent", name: "RAP2200", sku: "RAP2200", productKind: "product", barcode: null,
  categoryId: "network", brandId: null, suppliers: [], units: [], comboItems: [],
  baseUnit: "cái", costPrice: "990000", retailPrice: "1190000", wholesalePrice: null,
  contractorPrice: null, agentPrice: null, imageUrls: [], imageMedia: [], location: null,
  description: "Thông số kỹ thuật: hai băng tần", specs: null, isActive: true, totalStock: "0",
};
const e = { ...base, id: "e", sku: "RG-RAP2200(E)", name: "RAP2200 E", variantName: "E", costPrice: "1280000", retailPrice: "1490000", specs: { "Phiên bản": ["E"] } };
const f = { ...base, id: "f", sku: "RG-RAP2200(F)", name: "RAP2200 F", variantName: "F", totalStock: "2", specs: { "Phiên bản": ["F"] } };
const grouped = {
  ...base, isVariantParent: true,
  variantGroup: { id: "parent", name: "RAP2200", kind: "native", revision: 4,
    attributes: [{ attributeId: "version", name: "Phiên bản", values: ["E", "F"], valueIds: ["e-option", "f-option"], createsVariants: true }],
    members: [e, f], excludedCombinationKeys: [], requiresReview: false },
} as unknown as ProductDetail;

test("group edit preserves real SKU prices, stock, identity and technical description", () => {
  const draft = productToFormInitialValues(grouped, "groupEdit");
  assert.equal(draft.variantGroupId, "parent");
  assert.equal(draft.variantOperation, "edit");
  assert.equal(draft.variantRevision, 4);
  assert.equal(draft.description, base.description);
  assert.deepEqual(draft.variantChildren?.map((row) => [row.productId, row.sku, row.costPrice, row.retailPrice, row.currentStock, row.initialStock]), [
    ["e", "RG-RAP2200(E)", 1280000, 1490000, 0, 0],
    ["f", "RG-RAP2200(F)", 990000, 1190000, 2, 0],
  ]);
  assert.notEqual(draft.variantChildren?.[0].combinationKey, draft.variantChildren?.[1].combinationKey);
});

test("copying a group clears persisted SKU identity and all opening stock", () => {
  const draft = productToFormInitialValues(grouped, "copy");
  assert.equal(draft.variantGroupId, undefined);
  assert.equal(draft.variantOperation, "create");
  assert.equal(draft.variantChildren?.length, 2);
  assert.ok(draft.variantChildren?.every((child) => !child.productId && !child.sku && child.initialStock === 0));
  assert.deepEqual(draft.attributes?.[0].valueIds, ["e-option", "f-option"]);
});

test("group footer copies an imported sellable root and all siblings without changing ordinary SKU copy", () => {
  const imported = { ...e, isVariantParent: false,
    variantGroup: { ...grouped.variantGroup!, id: "e", kind: "related", members: [e, f] },
  } as unknown as ProductDetail;
  const draft = productToFormInitialValues(imported, "groupCopy");
  assert.equal(draft.variantOperation, "create");
  assert.equal(draft.variantGroupId, undefined);
  assert.equal(draft.variantRevision, undefined);
  assert.deepEqual(draft.variantChildren?.map((child) => [child.variantName, child.costPrice, child.retailPrice]), [
    ["E", 1280000, 1490000], ["F", 990000, 1190000],
  ]);
  assert.ok(draft.variantChildren?.every((child) => !child.productId && !child.sku && !child.barcode && child.initialStock === 0));
  const single = productToFormInitialValues(imported, "copy");
  assert.equal(single.variantChildren, undefined);
  assert.equal(single.sku, "");
  assert.equal(single.initialStock, 0);
});

test("same-type action targets the existing group instead of making another parent", () => {
  const draft = productToFormInitialValues(grouped, "sameType");
  assert.equal(draft.variantOperation, "add");
  assert.equal(draft.variantGroupId, "parent");
  assert.deepEqual(draft.variantChildren?.map((child) => child.productId), ["e", "f"]);
});

test("a simple product without identifying attributes needs an explicit combination assignment", () => {
  const draft = productToFormInitialValues(base as unknown as ProductDetail, "sameType");
  assert.equal(draft.variantGroupId, "parent");
  assert.equal(draft.variantChildren?.[0].productId, "parent");
  assert.equal(draft.variantChildren?.[0].combinationKey, undefined);
  assert.deepEqual(draft.attributes, []);
});

test("ambiguous imported selections are not silently assigned to the same combination", () => {
  const ambiguous = { ...grouped, variantGroup: { ...grouped.variantGroup!, members: [e, { ...f, specs: e.specs }] } } as unknown as ProductDetail;
  const draft = productToFormInitialValues(ambiguous, "groupEdit");
  assert.ok(draft.variantChildren?.every((child) => !child.combinationKey));
  assert.deepEqual(draft.variantChildren?.map((child) => child.productId), ["e", "f"]);
});

test("editing a single SKU retains selected attributes without generating children", () => {
  const draft = productToFormInitialValues(f as unknown as ProductDetail, "edit");
  assert.deepEqual(draft.attributes, [{ name: "Phiên bản", values: ["F"], createsVariants: false }]);
  assert.equal(draft.variantChildren, undefined);
  assert.equal(draft.currentStock, 2);
});

test("v2 technical metadata with multiple values does not require variant rows", () => {
  const parsed = createProductSchema.parse({
    name: "Imported dual-band SKU",
    categoryId: "network",
    variantContractVersion: 2,
    variantOperation: "edit",
    attributes: [{
      attributeId: "band",
      name: "Băng tần",
      values: ["2,4 GHz", "5 GHz"],
      valueIds: ["band-24", "band-5"],
      createsVariants: false,
    }],
  });
  assert.equal(parsed.variantChildren.length, 0);
  assert.equal(parsed.requestId, undefined);
});

test("group entrypoints resolve the real root before seeding common fields", async () => {
  const child = { ...f, description: "Thông số riêng F", categoryId: "child-category", brandId: "child-brand",
    imageUrls: ["https://example.test/f.png"], variantGroup: grouped.variantGroup } as unknown as ProductDetail;
  for (const mode of ["groupEdit", "groupAdd", "sameType", "groupCopy"] as const) {
    const source = await resolveProductFormSeed(child, mode, async (id) => {
      assert.equal(id, grouped.id);
      return grouped;
    });
    assert.equal(source, grouped);
    const draft = productToFormInitialValues(source!, mode);
    assert.equal(draft.description, base.description);
    assert.equal(draft.categoryId, base.categoryId);
    assert.equal(draft.brandId, "");
    assert.deepEqual(draft.imageUrls, []);
  }
  assert.equal(await resolveProductFormSeed(child, "edit", async () => { throw new Error("single SKU editor must not load group root"); }), child);
  assert.equal(await resolveProductFormSeed(child, "groupEdit", async () => null), null);
});

test("a 236-SKU imported group opens with all persisted identities assigned", () => {
  const values = Array.from({ length: 236 }, (_, index) => String(index + 1));
  const members = values.map((value) => ({ ...e, id: `sku-${value}`, sku: `IMPORTED-${value}`, variantName: value, specs: { SIZE: [value] } }));
  const source = { ...grouped, variantGroup: { ...grouped.variantGroup!,
    attributes: [{ attributeId: "size", name: "SIZE", values, valueIds: values.map((value) => `size-${value}`), createsVariants: true }],
    members,
  } } as unknown as ProductDetail;
  const draft = productToFormInitialValues(source, "groupEdit");
  assert.equal(draft.variantChildren?.length, 236);
  assert.ok(draft.variantChildren?.every((child) => child.productId && child.combinationKey));
  assert.equal(new Set(draft.variantChildren?.map((child) => child.combinationKey)).size, 236);
});

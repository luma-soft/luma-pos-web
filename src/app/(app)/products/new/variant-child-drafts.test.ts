import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVariantCombinations } from "@/lib/products/variant-model";
import { initialVariantCombinationBudget, reconcileVariantChildDrafts } from "./variant-child-drafts";

const attributes = [{ attributeId: "version", name: "Phiên bản", values: ["E"], valueIds: ["e"], createsVariants: true }];

test("form reconciliation preserves existing null tier prices and inactive state against group defaults", () => {
  const original = { ...buildVariantCombinations(attributes)[0], productId: "existing-e", sku: "RAP2200(E)",
    costPrice: 1280000, retailPrice: 1490000, wholesalePrice: null, contractorPrice: null, agentPrice: null,
    directSale: false, currentStock: 2, initialStock: 0, baseUnit: "cái", imageUrls: [] };
  const renamed = buildVariantCombinations([{ ...attributes[0], values: ["E mới"] }]);
  const [next] = reconcileVariantChildDrafts(renamed, [original], {
    costPrice: 990000, retailPrice: 1190000, wholesalePrice: 800000, contractorPrice: 900000, agentPrice: 1000000,
    directSale: true, initialStock: 999, imageUrls: ["https://example.test/group.png"],
  });
  assert.deepEqual(next, { ...original, ...renamed[0] });
});

test("form reconciliation applies defaults only to a genuinely new combination", () => {
  const row = buildVariantCombinations(attributes)[0];
  const [next] = reconcileVariantChildDrafts([row], [], {
    costPrice: 990000, retailPrice: 1190000, wholesalePrice: 800000, contractorPrice: 900000, agentPrice: 1000000,
  });
  assert.equal(next.wholesalePrice, 800000);
  assert.equal(next.contractorPrice, 900000);
  assert.equal(next.agentPrice, 1000000);
  assert.equal(next.sku, "");
  assert.equal(next.initialStock, 0);
});

test("the initial form budget counts saved members and saved exclusions, never an unsaved group's exclusions", () => {
  const variantChildren = Array.from({ length: 236 }, (_, i) => ({ ...buildVariantCombinations(attributes)[0], productId: `saved-${i}` }));
  assert.equal(initialVariantCombinationBudget({ variantGroupId: "group", variantChildren, excludedCombinationKeys: ["old-exclusion"] }), 437);
  assert.equal(initialVariantCombinationBudget({ variantChildren, excludedCombinationKeys: ["draft-exclusion"] }), undefined);
});

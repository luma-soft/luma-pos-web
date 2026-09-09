import { test } from "node:test";
import assert from "node:assert/strict";
import { createProductSchema } from "./schema";
import { prepareVariantAddition, variantAddFieldLabel } from "./variant-add";

const base = createProductSchema.parse({
  name: "Gạch Lâm Hưng - 10124",
  categoryId: "00000000-0000-4000-8000-000000000001",
  sku: "",
  barcode: "",
  baseUnit: "m2",
  costPrice: 130000,
  retailPrice: 150000,
  initialStock: 0,
  variantContractVersion: 2,
  variantOperation: "add",
  variantGroupId: "00000000-0000-4000-8000-000000000002",
  variantRevision: 4,
  requestId: "00000000-0000-4000-8000-000000000003",
  variantTemplateProductId: "00000000-0000-4000-8000-000000000004",
  attributes: [{
    attributeId: "00000000-0000-4000-8000-000000000005",
    name: "Mã",
    values: ["10121", "10122"],
    valueIds: [
      "00000000-0000-4000-8000-000000000006",
      "00000000-0000-4000-8000-000000000007",
    ],
    createsVariants: true,
  }],
  variantAddValues: { "00000000-0000-4000-8000-000000000005": "10124" },
  variantExistingCombinationKeys: [
    '[["00000000-0000-4000-8000-000000000005","00000000-0000-4000-8000-000000000006"]]',
    '[["00000000-0000-4000-8000-000000000005","00000000-0000-4000-8000-000000000007"]]',
  ],
});

test("compact group addition creates exactly one new SKU and preserves existing combinations", () => {
  const result = prepareVariantAddition(base);
  assert.equal(result.variantChildren.length, 1);
  assert.equal(result.variantChildren[0].name, base.name);
  assert.equal(result.variantChildren[0].variantName, "10124");
  assert.equal(result.variantChildren[0].initialStock, 0);
  assert.deepEqual(result.attributes[0].values, ["10121", "10122", "10124"]);
  assert.deepEqual(result.excludedCombinationKeys, []);
});

test("compact group addition rejects a value already present in the locked attribute", () => {
  assert.throws(
    () => prepareVariantAddition({ ...base, variantAddValues: { "00000000-0000-4000-8000-000000000005": " 10122 " } }),
    /products\.variants\.invalidValues/,
  );
});

test("attribute label does not repeat the word mã", () => {
  assert.equal(variantAddFieldLabel("MÃ"), "MÃ");
  assert.equal(variantAddFieldLabel("Mã hàng"), "Mã hàng");
  assert.equal(variantAddFieldLabel("Phiên bản"), "Mã Phiên bản");
});

test("group add form accepts more than 200 combinations when they are existing SKUs", () => {
  const attributeId = "00000000-0000-4000-8000-000000000005";
  const values = Array.from({ length: 236 }, (_, index) => String(index + 1));
  const valueIds = values.map((_, index) => `existing-value-${index + 1}`);
  const result = createProductSchema.safeParse({
    ...base,
    attributes: [{
      attributeId,
      name: "Mã",
      values,
      valueIds,
      createsVariants: true,
    }],
    variantChildren: [],
    variantExistingCombinationKeys: valueIds.map((valueId) => JSON.stringify([[attributeId, valueId]])),
    variantAddValues: { [attributeId]: "237" },
  });
  assert.equal(result.success, true, result.success ? undefined : result.error.issues[0]?.message);
});

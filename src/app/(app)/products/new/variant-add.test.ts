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

test("compact group addition reuses existing attribute values for a new combination", () => {
  const sizeId = "00000000-0000-4000-8000-000000000010";
  const size140Id = "00000000-0000-4000-8000-000000000011";
  const size150Id = "00000000-0000-4000-8000-000000000012";
  const pipeTypeId = "00000000-0000-4000-8000-000000000013";
  const pipeC2Id = "00000000-0000-4000-8000-000000000014";
  const pipeC3Id = "00000000-0000-4000-8000-000000000015";
  const result = prepareVariantAddition({
    ...base,
    attributes: [
      {
        attributeId: sizeId,
        name: "SIZE",
        values: ["140", "150"],
        valueIds: [size140Id, size150Id],
        createsVariants: true,
      },
      {
        attributeId: pipeTypeId,
        name: "LOẠI ỐNG",
        values: ["C2", "C3"],
        valueIds: [pipeC2Id, pipeC3Id],
        createsVariants: true,
      },
    ],
    variantAddValues: { [sizeId]: "140", [pipeTypeId]: "C2" },
    variantExistingCombinationKeys: [
      JSON.stringify([[sizeId, size140Id], [pipeTypeId, pipeC3Id]]),
      JSON.stringify([[sizeId, size150Id], [pipeTypeId, pipeC2Id]]),
    ],
  });

  assert.equal(result.variantChildren.length, 1);
  assert.equal(result.variantChildren[0].variantName, "140 / C2");
  assert.deepEqual(result.variantChildren[0].optionValueIds, [size140Id, pipeC2Id]);
  assert.deepEqual(result.attributes[0].values, ["140", "150"]);
  assert.deepEqual(result.attributes[1].values, ["C2", "C3"]);
  assert.deepEqual(result.excludedCombinationKeys, [
    JSON.stringify([[sizeId, size150Id], [pipeTypeId, pipeC3Id]]),
  ]);
  const parsed = createProductSchema.safeParse(result);
  assert.equal(parsed.success, true, parsed.success ? undefined : parsed.error.issues[0]?.message);
});

test("compact group addition rejects a combination already assigned to a SKU", () => {
  assert.throws(
    () => prepareVariantAddition({ ...base, variantAddValues: { "00000000-0000-4000-8000-000000000005": " 10122 " } }),
    /products\.variants\.invalidCombination/,
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

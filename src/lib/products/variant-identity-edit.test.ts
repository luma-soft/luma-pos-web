import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVariantValueEdits } from "./variant-identity-edit";

const attributes = [{
  attributeId: "code",
  name: "MÃ",
  values: ["13101 Điểm", "13102 Điểm"],
  valueIds: ["code-13101", "code-13102"],
  createsVariants: true as const,
}];

test("an existing SKU value can be renamed while preserving its option identity", () => {
  const result = applyVariantValueEdits(attributes, [{
    attributeId: "code",
    optionValueId: "code-13102",
    value: "13103 Điểm",
  }]);
  assert.deepEqual(result[0].values, ["13101 Điểm", "13103 Điểm"]);
  assert.deepEqual(result[0].valueIds, ["code-13101", "code-13102"]);
});

test("a duplicate SKU value is rejected after trimming and case normalization", () => {
  assert.throws(() => applyVariantValueEdits(attributes, [{
    attributeId: "code",
    optionValueId: "code-13102",
    value: "  13101   ĐIỂM ",
  }]), /products\.variants\.invalidValues/);
});

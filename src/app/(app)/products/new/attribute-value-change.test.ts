import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeValueChange } from "./attribute-value-change";
import { createProductSchema } from "./schema";

for (const label of ["1*1.0", "1*1.0*"]) {
  test(`renaming a selected SKU to ${label} preserves identity and passes single-product validation`, () => {
    const attribute = { attributeId: "size", name: "SIZE", values: ["1*1.0 Vàng"], valueIds: ["size-gold"], createsVariants: false };
    const changed = attributeValueChange(attribute, [label], attribute.valueIds, true);
    assert.deepEqual(changed.valueIds, attribute.valueIds);
    const result = createProductSchema.safeParse({ name: "Dây", categoryId: "cable", variantContractVersion: 2, attributes: [changed] });
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    assert.equal(changed.createsVariants, false);
  });
}

test("unlocked group editing still enables variant generation", () => {
  const changed = attributeValueChange({ name: "SIZE", values: [], createsVariants: false }, ["1*1.0"], ["size"], false);
  assert.equal(changed.createsVariants, true);
});

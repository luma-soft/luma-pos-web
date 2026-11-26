import { readSource } from "../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";

const productForm = readSource("./new/product-form.tsx", import.meta.url);
const variantChildrenField = readSource("./new/variant-children-field.tsx", import.meta.url);
const vi = JSON.parse(readSource("../../../../messages/vi.json", import.meta.url));

test("an existing product points users to the safe variant workflow", () => {
  expect(vi.products.saveAndCreateVariant).toBe("Lưu & tạo biến thể");
  expect(productForm).toContain('createVariantAfterSave={isEdit && productKind === "product"}');
  expect(productForm).toContain('t("products.variants.lockedStandaloneHint")');
  expect(productForm).toContain("Routes.productGroupEdit(groupId)");
});

test("an existing grouped SKU can edit its value but keeps group structure locked", () => {
  expect(productForm).toContain("allowValueEdits={isEdit && !groupEditing && Boolean(groupId)}");
  expect(vi.products.variants.lockedSkuHint).toContain("không lưu nếu trùng");
});

test("variant status badges stay on one line inside the table column", () => {
  expect(variantChildrenField).toContain("inline-flex whitespace-nowrap rounded-full");
});

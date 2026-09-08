import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const productForm = readFileSync(new URL("./new/product-form.tsx", import.meta.url), "utf8");
const vi = JSON.parse(readFileSync(new URL("../../../../messages/vi.json", import.meta.url), "utf8"));

test("an existing product points users to the safe variant workflow", () => {
  expect(vi.products.saveAndCreateVariant).toBe("Lưu & tạo biến thể");
  expect(productForm).toContain('createVariantAfterSave={isEdit && productKind === "product"}');
  expect(productForm).toContain('t("products.variants.lockedStandaloneHint")');
  expect(productForm).toContain("Routes.productGroupEdit(groupId)");
});

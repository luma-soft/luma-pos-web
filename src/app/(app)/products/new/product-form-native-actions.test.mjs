import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./product-form.tsx",import.meta.url),"utf8");
const vi=JSON.parse(readFileSync(new URL("../../../../../messages/vi.json",import.meta.url),"utf8"));
const en=JSON.parse(readFileSync(new URL("../../../../../messages/en.json",import.meta.url),"utf8"));
test("native mobile toolbar exposes cancel and save without duplicate bottom buttons",()=>{
  const head=src.slice(src.indexOf("      <header className={cn("),src.indexOf("      </header>"));
  expect(head).toContain('tx="common.cancel"');
  expect(head).toContain('tx="common.save"');
  expect(head).toContain('onClick={() => setSubmitIntent("save")}');
  expect(src).toContain("hidden lg:contents");
  expect(src).toContain("lg:py-3 lg:pb-3");
});
test("advanced web features survive in collapsed mobile save options",()=>{
  expect(src).toContain("<MobileProductSaveOptions");
  expect(src).toContain('form.setValue("directSale", checked, { shouldDirty: true })');
  expect(src).toContain('onIntent("sameType")');
  expect(src).toContain('tx={createVariantAfterSave ? "products.saveAndCreateVariant"');
  expect(vi.products.moreSaveOptions).toBe("Tùy chọn lưu");
  expect(en.products.moreSaveOptions).toBe("Save options");
});

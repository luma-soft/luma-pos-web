import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./product-form.tsx", import.meta.url), "utf8");
test("product wizard mobile tabs are equally sized and localized", () => {
  expect(src).toContain("flex items-end gap-0 lg:gap-6");
  expect(src).toContain("min-h-12 min-w-0 flex-1 border-b-2");
  expect(src).toContain('title={t(`products.tabs.${tk}`)}');
  expect(src).toContain("aria-current={tab === tk");
  expect(src).not.toContain('tk === "description" ? "Mô tả, ghi chú"');
});
test("invalid info fields navigate back from any non-info step", () => {
  expect(src).toContain('if (tab === "info") return;');
  expect(src).toContain('if (infoFields.some((field) => errors[field])) setTab("info")');
  expect(src).toContain('onSubmit={onSubmit}');
});

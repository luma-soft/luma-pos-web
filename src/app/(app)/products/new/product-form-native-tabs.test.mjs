import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const src = readSource("./product-form.tsx", import.meta.url);
test("product wizard mobile tabs are equally sized and localized", () => {
  expect(src).toContain("flex items-end gap-0 lg:gap-6");
  expect(src).toContain("min-h-12 min-w-0 flex-1 whitespace-nowrap border-b-2");
  // Phones show the native tab names (Cơ bản / Đơn vị & Thuộc tính / Mô tả).
  expect(src).toContain("mobile.products.tabs.${tk}");
  expect(src).toContain('title={t(`products.tabs.${tk}`)}');
  expect(src).toContain("aria-current={tab === tk");
  expect(src).not.toContain('tk === "description" ? "Mô tả, ghi chú"');
});
test("invalid info fields navigate back from any non-info step", () => {
  expect(src).toContain('if (tab === "info") return;');
  expect(src).toContain('if (infoFields.some((field) => errors[field])) setTab("info")');
  expect(src).toContain('onSubmit={onSubmit}');
});

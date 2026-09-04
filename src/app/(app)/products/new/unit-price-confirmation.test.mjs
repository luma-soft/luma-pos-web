import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next-intl", () => ({ useTranslations: () => (key) => key, useLocale: () => "vi" }));
const { UnitPriceConfirmationContent } = await import("./unit-price-confirmation");
const before = { baseUnit: "m", retailPrice: 15000, costPrice: 11000, units: [{ id: "tree", unitName: "Cây", multiplier: 4, priceOverride: 60000 }] };
const noop = () => {};
function render(patch = {}) {
  return renderToStaticMarkup(createElement(UnitPriceConfirmationContent, {
    name: "Ống nhựa", before, draft: { ...before, retailPrice: 16000 }, mode: "keep", source: "base",
    onMode: noop, onSource: noop, onCancel: noop, onConfirm: noop, titleId: "confirm-title", descriptionId: "confirm-desc", ...patch,
  }));
}
describe("product multi-unit confirmation UI", () => {
  test("shows before/after, fixed-price mode and explicit cancel/commit actions", () => {
    const html = render();
    expect(html).toContain("Xác nhận thay đổi giá");
    expect(html).toContain("Giá sau khi lưu");
    expect(html).toContain("60.000 đ");
    expect(html).toContain("16.000 đ");
    expect(html).toContain("Giữ giá riêng");
    expect(html).toContain("Quay lại");
    expect(html).toContain("Xác nhận &amp; lưu");
    expect(html).not.toContain("<select");
  });
  test("sync preview shows actual derived tree price and explicit source choices", () => {
    const html = render({ mode: "sync" });
    expect(html).toContain("64.000 đ");
    expect(html).toContain("Lấy giá từ đơn vị");
    expect(html).toContain("Quy đổi");
    expect(html).not.toContain("<select");
  });
  test("conflicting sources block commit until the user selects one", () => {
    const html = render({ mode: "sync", source: null, draft: { ...before, retailPrice: 16000, units: [{ ...before.units[0], priceOverride: 68000 }] } });
    expect(html).toContain("Chưa tính giá mới vì chưa chọn nguồn");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Xác nhận &amp; lưu/);
    expect(html).not.toContain("<table");
  });
  test("cost-only edits have a review but no retail synchronization choice", () => {
    const html = render({ draft: { ...before, costPrice: 12000 } });
    expect(html).toContain("Giá vốn");
    expect(html).toContain("48.000 đ");
    expect(html).not.toContain("Cách cập nhật Giá chung");
    expect(html).not.toContain("Đồng bộ theo tỷ lệ");
  });
  test("warns when unit synchronization also affects selected sibling products", () => {
    const html = render({ mode: "sync", siblingScope: { count: 3, pricing: false, units: true } });
    expect(html).toContain("3 sản phẩm cùng loại");
    expect(html).toContain("Giá riêng theo đơn vị của các sản phẩm đó cũng sẽ được xóa");
    expect(html).toContain("Bảng trên chỉ xem trước sản phẩm đang sửa");
  });
  test("admin resolver controls the displayed exact plan without changing product-editor defaults", () => {
    let selected;
    const html = render({ mode: "sync", source: "unit:tree", resolveChoice: (mode, source) => {
      selected = [mode, source];
      return { ...before, retailPrice: 10.08, units: [{ ...before.units[0], priceOverride: null }] };
    } });
    expect(selected).toEqual(["sync", "unit:tree"]);
    expect(html).toContain("10,08 đ");
    expect(html).toContain("40 đ");
    expect(html).not.toContain("64.000 đ");
  });
});

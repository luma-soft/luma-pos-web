import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next-intl", () => ({ useTranslations: () => (key) => key, useLocale: () => "vi" }));
const { PricingUnitEditors, pricingMoneyLabel } = await import("./pricing-unit-editors");
const retail = { id: "retail", name: "Giá chung", isDefault: true, systemType: "retail" };
const custom = { id: "trade", name: "Giá thợ", isDefault: false };
const row = { id: "p1", name: "Ống C3", baseUnit: "m", prices: { retail: 20.15, trade: 18.5, cost: 10.08, purchase: null }, units: [
  { id: "base", unitName: "m", multiplier: 1, priceOverride: 1 },
  { id: "tree", unitName: "cây", multiplier: 4, priceOverride: 60.25 },
  { id: "sample", unitName: "mẫu", multiplier: 0.25, priceOverride: 0 },
  { id: "bundle", unitName: "bó", multiplier: 20, priceOverride: null },
] };
const render = (book, patch = {}) => renderToStaticMarkup(createElement(PricingUnitEditors, { row, book, retailId: "retail", onCommit: () => {}, ...patch }));

describe("pricing alternate-unit rows", () => {
  test("all alternate units are visible, fixed zero is retained and the duplicate base is omitted", () => {
    const html = render(retail);
    expect(html.match(/<input/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Giá chung / cây"');
    expect(html).toContain('value="60,25"');
    expect(html).toContain('value="0"');
    expect(html).toContain('value="403"');
    expect(html).toContain("1 mẫu = 0,25 m");
    expect(html).not.toContain('aria-label="Giá chung / m"');
    expect(html).not.toContain("<select");
  });
  test("cost and missing purchase are read-only for every unit", () => {
    const cost = render({ id: "cost", name: "Giá vốn", systemType: "cost" });
    const purchase = render({ id: "purchase", name: "Giá nhập cuối", systemType: "purchase" });
    expect(cost).not.toContain("<input");
    expect(cost).toContain("40 đ");
    expect(purchase).not.toContain("<input");
    expect(purchase).not.toContain("60,25");
    expect(purchase.match(/>—</g)).toHaveLength(3);
  });
  test("custom zero-ratio unit is read-only with a base-edit explanation", () => {
    const html = render(custom);
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Giá thợ / mẫu"');
    expect(html).toContain("Sửa giá tại m");
    expect(html).toContain("chỉ xóa giá tại đơn vị gốc");
  });
  test("decimal formula display does not hide half-cent rounding or source precision", () => {
    expect(pricingMoneyLabel(10.08)).toBe("10,08 đ");
    expect(pricingMoneyLabel(20.15)).toBe("20,15 đ");
    expect(pricingMoneyLabel(null)).toBe("—");
  });
});

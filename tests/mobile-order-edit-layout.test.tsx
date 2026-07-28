import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderEditMobileLineLayout } from "@/components/order-edit-mobile-line";

const source = readFileSync(
  "src/app/(app)/orders/[id]/edit/order-edit-form.tsx",
  "utf8",
);

describe("mobile order edit line parity", () => {
  test("renders a card editor below lg and preserves the desktop table", () => {
    expect(source).toContain('data-testid="order-edit-mobile-lines"');
    expect(source).toContain('className="space-y-3 p-3 lg:hidden"');
    expect(source).toContain('className="hidden overflow-x-auto lg:block"');
    expect(source).toContain('data-testid="order-edit-desktop-table"');
  });

  test("mobile cards wire the same quantity, price, and delete mutations", () => {
    const mobileStart = source.indexOf('data-testid="order-edit-mobile-lines"');
    const desktopStart = source.indexOf('data-testid="order-edit-desktop-table"');
    const mobile = source.slice(mobileStart, desktopStart);

    expect(mobileStart).toBeGreaterThan(0);
    expect(desktopStart).toBeGreaterThan(mobileStart);
    expect(mobile).toContain("<OrderEditMobileLine");
    expect(mobile).toContain("patch(idx, { quantity })");
    expect(mobile).toContain("patch(idx, { unitPrice })");
    expect(mobile).toContain("ls.filter((_, i) => i !== idx)");
  });

  test("rendered card preserves every editable line field at narrow widths", () => {
    const html = renderToStaticMarkup(createElement(OrderEditMobileLineLayout, {
      productName: "Camera ngoài trời",
      unitName: "Cái",
      labels: {
        unit: "Đơn vị",
        quantity: "Số lượng",
        unitPrice: "Đơn giá",
        lineTotal: "Thành tiền",
        delete: "Xóa",
      },
      quantityControl: createElement("input", {
        "aria-label": "Số lượng",
        className: "w-[132px]",
        value: 2,
        readOnly: true,
      }),
      unitPriceControl: createElement("input", {
        "aria-label": "Đơn giá",
        value: "20.000",
        readOnly: true,
      }),
      lineTotal: "40.000 ₫",
      onDelete: () => undefined,
    }));

    expect(html).toContain("Camera ngoài trời");
    expect(html).toContain("Đơn vị: Cái");
    expect(html).toContain("Số lượng");
    expect(html).toContain("Đơn giá");
    expect(html).toContain("Thành tiền");
    expect(html).toContain('aria-label="Xóa"');
    expect(html).toContain("w-[132px]");
    expect(html).toContain('value="20.000"');
    expect(html).toContain("40.000");
  });
});

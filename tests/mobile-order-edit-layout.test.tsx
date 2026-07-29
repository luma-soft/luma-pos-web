import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  OrderEditMobileLine,
  OrderEditMobileLineLayout,
} from "@/components/order-edit-mobile-line";
import enMessages from "../messages/en.json";
import viMessages from "../messages/vi.json";

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

  test("two product lines have unique headings and product-specific localized quantity controls", () => {
    const renderLines = (
      locale: "vi" | "en",
      messages: typeof viMessages,
    ) =>
      renderToStaticMarkup(
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          timeZone="Asia/Ho_Chi_Minh"
        >
          <OrderEditMobileLine
            line={{
              productName: "Camera sân trước",
              unitName: "Cái",
              quantity: 1,
              unitPrice: 1200000,
            }}
            labels={{
              unit: "Unit",
              quantity: "Quantity",
              unitPrice: "Unit price",
              lineTotal: "Line total",
              delete: "Delete",
            }}
            inputClassName=""
            onQuantityChange={() => undefined}
            onUnitPriceChange={() => undefined}
            onDelete={() => undefined}
          />
          <OrderEditMobileLine
            line={{
              productName: "Camera kho sau",
              unitName: "Cái",
              quantity: 2,
              unitPrice: 1500000,
            }}
            labels={{
              unit: "Unit",
              quantity: "Quantity",
              unitPrice: "Unit price",
              lineTotal: "Line total",
              delete: "Delete",
            }}
            inputClassName=""
            onQuantityChange={() => undefined}
            onUnitPriceChange={() => undefined}
            onDelete={() => undefined}
          />
        </NextIntlClientProvider>,
      );

    const viHtml = renderLines("vi", viMessages);
    const enHtml = renderLines("en", enMessages);
    const headingIds = [
      ...viHtml.matchAll(
        /<h3 id="([^"]+)"[^>]*>Camera (?:sân trước|kho sau)<\/h3>/g,
      ),
    ].map((match) => match[1]);

    expect(headingIds).toHaveLength(2);
    expect(new Set(headingIds).size).toBe(2);
    for (const headingId of headingIds) {
      expect(viHtml).toContain(`aria-labelledby="${headingId}"`);
    }

    for (const product of ["Camera sân trước", "Camera kho sau"]) {
      expect(viHtml).toContain(`aria-label="Giảm số lượng ${product}"`);
      expect(viHtml).toContain(`aria-label="Số lượng ${product}"`);
      expect(viHtml).toContain(`aria-label="Tăng số lượng ${product}"`);
      expect(enHtml).toContain(
        `aria-label="Decrease quantity for ${product}"`,
      );
      expect(enHtml).toContain(`aria-label="Quantity for ${product}"`);
      expect(enHtml).toContain(
        `aria-label="Increase quantity for ${product}"`,
      );
    }
    expect(viHtml).not.toContain('aria-label="Decrease quantity"');
    expect(viHtml).not.toContain('aria-label="Quantity"');
    expect(viHtml).not.toContain('aria-label="Increase quantity"');
    expect(enHtml).not.toContain('aria-label="Decrease quantity"');
    expect(enHtml).not.toContain('aria-label="Quantity"');
    expect(enHtml).not.toContain('aria-label="Increase quantity"');
  });
});

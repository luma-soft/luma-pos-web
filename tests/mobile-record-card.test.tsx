import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileFormLineCard, MobileRecordCard, MobileRecordField } from "@/components/mobile-ui";

describe("MobileRecordCard", () => {
  test("renders a mobile-only semantic record with status and fields", () => {
    const html = renderToStaticMarkup(
      <MobileRecordCard title="PN-001" subtitle="28/07/2026" status="Đã nhận">
        <MobileRecordField label="Tổng tiền" value="1.250.000 ₫" tone="success" />
      </MobileRecordCard>,
    );
    expect(html).toContain("<article");
    expect(html).toContain("lg:hidden");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("1.250.000 ₫");
  });
});

describe("MobileFormLineCard", () => {
  test("renders form controls inside a mobile-only section", () => {
    const html = renderToStaticMarkup(
      <MobileFormLineCard title="Camera H6C" subtitle="SP-001" amount="1.250.000 ₫">
        <input aria-label="Số lượng" value="1" readOnly />
      </MobileFormLineCard>,
    );

    expect(html).toContain("<section");
    expect(html).toContain("lg:hidden");
    expect(html).toContain('aria-label="Số lượng"');
    expect(html).not.toContain("<dl");
  });
});

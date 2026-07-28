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
    expect(html).toContain("28/07/2026");
    expect(html).toContain("Đã nhận");
    expect(html).toContain("1.250.000 ₫");
    expect(html).toContain("text-ok");
  });

  test("renders zero-valued optional content", () => {
    const html = renderToStaticMarkup(
      <MobileRecordCard title="PN-001" subtitle={0} status={0} actions={0}>
        Fields
      </MobileRecordCard>,
    );

    expect(html).toMatch(/<p[^>]*>0<\/p>/);
    expect(html).toContain('<div class="shrink-0">0</div>');
    expect(html).toMatch(/<div class="[^"]*border-border-soft[^"]*">0<\/div>/);
  });

  test("maps warning and danger field tones", () => {
    const html = renderToStaticMarkup(
      <MobileRecordCard title="PN-001">
        <MobileRecordField label="Sắp đến hạn" value="500.000 ₫" tone="warning" />
        <MobileRecordField label="Quá hạn" value="250.000 ₫" tone="danger" />
      </MobileRecordCard>,
    );

    expect(html).toContain("text-warn");
    expect(html).toContain("text-er");
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

  test("renders zero-valued optional content", () => {
    const html = renderToStaticMarkup(
      <MobileFormLineCard title="Camera H6C" subtitle={0} amount={0} actions={0}>
        Form fields
      </MobileFormLineCard>,
    );

    expect(html).toMatch(/<p[^>]*>0<\/p>/);
    expect(html).toMatch(/<div class="[^"]*tabular-nums[^"]*">0<\/div>/);
    expect(html).toMatch(/<div class="[^"]*border-border-soft[^"]*">0<\/div>/);
  });
});

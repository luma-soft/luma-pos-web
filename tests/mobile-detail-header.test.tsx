import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileDetailHeader } from "@/components/mobile-detail-header";

describe("MobileDetailHeader", () => {
  test("renders an accessible 44px back target and detail context", () => {
    const markup = renderToStaticMarkup(
      <MobileDetailHeader
        backHref="/products"
        backLabel="Quay lại"
        title="Camera H6C Pro"
        subtitle="SP-001"
      />,
    );

    expect(markup).toContain('href="/products"');
    expect(markup).toContain('aria-label="Quay lại"');
    expect(markup).toContain("h-11");
    expect(markup).toContain("w-11");
    expect(markup).toContain(">Camera H6C Pro</h1>");
    expect(markup).toContain(">SP-001</p>");
  });

  test("keeps actions in a dedicated trailing group", () => {
    const markup = renderToStaticMarkup(
      <MobileDetailHeader
        backHref="/customers"
        backLabel="Back"
        title="Customer"
        actions={<button type="button">Edit</button>}
      />,
    );

    expect(markup).toContain('data-slot="mobile-detail-actions"');
    expect(markup).toContain(">Edit</button>");
  });
});

import { describe, expect, test } from "bun:test";
import Link from "next/link";
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

  test("reflows stacked mobile actions without hiding them in a horizontal scroller", () => {
    const markup = renderToStaticMarkup(
      <MobileDetailHeader
        backHref="/customers"
        backLabel="Quay lại"
        title="Khách hàng"
        stackActionsOnMobile
        actions={(
          <>
            <button type="button">Chỉnh sửa khách hàng</button>
            <Link href="/pos">Tạo đơn tại POS</Link>
          </>
        )}
      />,
    );

    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain("[&amp;&gt;*]:min-w-0");
    expect(markup).toContain("[&amp;&gt;button]:w-full");
    expect(markup).toContain("[&amp;&gt;a]:w-full");
    expect(markup).toContain("whitespace-normal");
    expect(markup).not.toContain("overflow-x-auto");
  });
});

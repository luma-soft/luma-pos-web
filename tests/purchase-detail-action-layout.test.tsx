import { describe, expect, test } from "bun:test";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { PurchaseDetailActionGroup } from "@/components/purchase-detail-action-group";

describe("purchase detail mobile actions", () => {
  test("keeps every receipt action visible in a bounded two-column grid", () => {
    const markup = renderToStaticMarkup(
      <PurchaseDetailActionGroup label="Thao tác phiếu nhập">
        <Link href="/print">In phiếu nhập</Link>
        <Link href="/copy">Sao chép phiếu nhập</Link>
        <Link href="/edit">Chỉnh sửa phiếu nhập</Link>
        <button type="button">Hủy phiếu nhập</button>
      </PurchaseDetailActionGroup>,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Thao tác phiếu nhập"');
    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain("[&amp;&gt;*]:min-w-0");
    expect(markup).toContain("[&amp;&gt;a]:w-full");
    expect(markup).toContain("[&amp;&gt;button]:w-full");
    expect(markup).toContain("whitespace-normal");
    expect(markup).toContain("lg:flex");
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).not.toContain("shrink-0");
  });
});

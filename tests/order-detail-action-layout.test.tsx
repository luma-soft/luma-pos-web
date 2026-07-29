import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderDetailActionGroup } from "@/components/order-detail-action-group";

describe("order detail mobile actions", () => {
  test("uses a bounded two-column grid for long invoice actions", () => {
    const html = renderToStaticMarkup(
      createElement(
        OrderDetailActionGroup,
        { label: "Thao tác hóa đơn" },
        createElement("button", null, "Gửi hóa đơn qua Zalo"),
        createElement("a", { href: "/print" }, "Chia sẻ bản in hóa đơn"),
        createElement("button", null, "Hủy hóa đơn"),
      ),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Thao tác hóa đơn"');
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("min-w-0");
    expect(html).toContain("[&amp;&gt;*]:min-w-0");
    expect(html).toContain("[&amp;&gt;a]:w-full");
    expect(html).toContain("[&amp;&gt;button]:w-full");
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("xl:flex");
    expect(html).not.toContain("flex-nowrap");
    expect(html).not.toContain("overflow-x-auto");
  });
});

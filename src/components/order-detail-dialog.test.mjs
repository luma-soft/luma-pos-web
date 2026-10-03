import { describe, expect, mock, test } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/partners",
  useSearchParams: () => new URLSearchParams("tab=customers&detailCustomerId=customer-1&q=Anh"),
}));

const { RowPreviewModal } = await import("./data-table.tsx");
const { OrderDetailDialog } = await import("./order-detail-dialog.tsx");
const { OrderDetailLink } = await import("./order-detail-link.tsx");

describe("invoice opened from customer history", () => {
  test("the invoice renders above the still-open customer modal", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(RowPreviewModal, {
        open: true, onClose() {}, title: "Khách hàng thử nghiệm",
      }, createElement(OrderDetailLink, { orderId: "order-1" }, "HD000001")),
      createElement(OrderDetailDialog, {
        title: "HD000001", subtitle: "Khách hàng thử nghiệm",
      }, "Chi tiết hóa đơn"),
    ));
    const layers = Array.from(html.matchAll(/class="fixed inset-0 z-\[(\d+)\]/g), (match) => Number(match[1]));
    expect(layers).toHaveLength(2);
    expect(layers[1]).toBeGreaterThan(layers[0]);
    expect(html.match(/role="dialog"/g)).toHaveLength(2);
  });

  test("opening an invoice preserves the customer and list filters", () => {
    const html = renderToStaticMarkup(createElement(OrderDetailLink, { orderId: "order-1" }, "HD000001"));
    const href = html.match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
    const url = new URL(href, "https://example.com");
    expect(url.pathname).toBe("/partners");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tab: "customers", detailCustomerId: "customer-1", q: "Anh", detailOrderId: "order-1",
    });
  });
});

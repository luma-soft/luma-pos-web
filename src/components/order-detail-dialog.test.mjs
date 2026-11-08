import { describe, expect, mock, test } from "bun:test";
import { createElement, Fragment } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

let activeSearchParams = new URLSearchParams("tab=customers&detailCustomerId=customer-1&q=Anh&detailOrderId=order-1");

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/partners",
  useSearchParams: () => activeSearchParams,
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
        orderId: "order-1", title: "HD000001", subtitle: "Khách hàng thử nghiệm",
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

  test("a closed invoice overlay stays hidden while the customer modal stays open", () => {
    const previous = activeSearchParams;
    activeSearchParams = new URLSearchParams("tab=customers&detailCustomerId=customer-1&q=Anh");
    try {
      const html = renderToStaticMarkup(createElement(Fragment, null,
        createElement(RowPreviewModal, {
          open: true, onClose() {}, title: "Khách hàng thử nghiệm",
        }, "Lịch sử mua hàng"),
        createElement(OrderDetailDialog, {
          orderId: "order-1", title: "HD000001", subtitle: "Khách hàng thử nghiệm",
        }, "Chi tiết hóa đơn"),
      ));
      expect(html.match(/role="dialog"/g)).toHaveLength(1);
      expect(html).not.toContain("Chi tiết hóa đơn");
      expect(html).toContain("Lịch sử mua hàng");
    } finally {
      activeSearchParams = previous;
    }
  });

  test("a stale invoice overlay cannot show while another invoice is selected", () => {
    const previous = activeSearchParams;
    activeSearchParams = new URLSearchParams("tab=orders&detailOrderId=order-2");
    try {
      const html = renderToStaticMarkup(createElement(OrderDetailDialog, {
        orderId: "order-1", title: "HD000001", subtitle: "Khách hàng thử nghiệm",
      }, "Chi tiết hóa đơn"));
      expect(html).toBe("");
    } finally {
      activeSearchParams = previous;
    }
  });

  test("invoice close updates the URL without server navigation", () => {
    const source = readFileSync(new URL("./order-detail-dialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("window.history.replaceState(\n      null,");
    expect(source).not.toContain("window.history.state,");
    expect(source).not.toContain("router.replace(");
    expect(source).toContain('url.searchParams.delete("detailOrderId")');
    expect(source).toContain("${url.pathname}${url.search}${url.hash}");
  });
});

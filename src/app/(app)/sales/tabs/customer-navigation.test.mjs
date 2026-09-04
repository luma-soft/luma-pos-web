import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/vi.json";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: "vi", messages }),
}));
mock.module("@/components/confirm-dialog-provider", () => ({
  useConfirmDialog: () => ({ confirm: async () => false, alert: async () => {} }),
}));
mock.module("@/lib/actions/orders", () => ({ cancelOrders: async () => ({ ok: false }) }));
mock.module("@/lib/auth/store-context", () => ({ requireStoreContext: async () => ({ storeId: "store-1" }) }));
mock.module("@/lib/print/template", () => ({
  getPrintTemplate: async () => null,
  getPrintTemplatesForDoc: async () => [],
}));
mock.module("./return-actions", () => ({ ReturnActions: () => null }));

const { OrdersTable, OrderMobileRow } = await import("./orders-table.tsx");
const { QuotesTable } = await import("./quotes-table.tsx");
const { BookingsTable } = await import("./bookings-table.tsx");
const { ReturnsTable } = await import("./returns-table.tsx");
const { ReturnDetailPanel } = await import("./return-detail-panel.tsx");

const row = {
  id: "document-1", code: "DH-001", customerId: "customer-1", customerName: "Anh Nhật",
  createdAt: new Date("2026-09-04T00:00:00Z"), total: "100000", amountPaid: "0",
  status: "completed", paymentStatus: "unpaid", sourceMode: "pos", projectName: null,
  deliveryDate: null, totalRefund: "100000", refundMethod: "cash", items: [],
};

function render(element) {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "vi", messages, timeZone: "Asia/Ho_Chi_Minh",
  }, element));
}

function assertCustomerLinks(html, count) {
  const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [])
    .filter((link) => link.includes('href="/partners?tab=customers&amp;detailCustomerId=customer-1"'));
  expect(links).toHaveLength(count);
  for (const link of links) {
    expect(link).toContain("Anh Nhật");
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  }
  for (const button of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []) {
    expect(button).not.toContain("detailCustomerId=");
  }
}

describe("sales customer detail navigation", () => {
  for (const [name, Table] of [["orders", OrdersTable], ["quotes", QuotesTable], ["bookings", BookingsTable], ["returns", ReturnsTable]]) {
    test(`${name}: desktop and mobile customer names are safe new-tab links outside document buttons`, () => {
      assertCustomerLinks(render(createElement(Table, { rows: [row], printTemplates: [] })), 2);
    });

    test(`${name}: walk-in customers have no detail link`, () => {
      const html = render(createElement(Table, { rows: [{ ...row, customerId: null, customerName: null }], printTemplates: [] }));
      expect(html).toContain(messages.orders.walkIn);
      expect(html).not.toContain("detailCustomerId=");
    });
  }

  for (const compact of [false, true]) {
    test(`return detail (${compact ? "dialog" : "page"}): heading and customer summary link to the customer`, async () => {
      assertCustomerLinks(render(await ReturnDetailPanel({ ret: row, compact })), 2);
    });

    test(`return detail (${compact ? "dialog" : "page"}): walk-in customer remains plain text`, async () => {
      const html = render(await ReturnDetailPanel({ ret: { ...row, customerId: null, customerName: null }, compact }));
      expect(html).toContain(messages.orders.walkIn);
      expect(html).not.toContain("detailCustomerId=");
    });
  }

  test("the mobile order action still opens its document independently of customer navigation", () => {
    let opened = 0;
    const element = OrderMobileRow({ order: row, selected: false, onToggle() {}, onOpen: () => opened++, labels: { walkIn: "Khách lẻ", remaining: "Còn lại" } });
    const buttons = [];
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "button") buttons.push(node);
      for (const child of [node.props?.children].flat()) visit(child);
    }
    visit(element);
    expect(buttons.length).toBeGreaterThan(0);
    buttons[0].props.onClick();
    expect(opened).toBe(1);
  });
});

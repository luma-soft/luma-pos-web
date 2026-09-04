import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/vi.json";

mock.module("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: "vi", messages }),
}));
mock.module("@/lib/auth/store-context", () => ({
  requireStoreContext: async () => ({ storeId: "store-1" }),
}));
mock.module("@/lib/data/settings", () => ({
  getStoreSettings: async () => ({ prefs: { zalo: { enabled: false } } }),
}));
mock.module("@/lib/print/template", () => ({
  getPrintTemplate: async () => null,
  getPrintTemplatesForDoc: async () => [],
}));
mock.module("./order-actions", () => ({
  OrderActions: () => null,
  PaymentForm: () => null,
  SendOrderZaloButton: () => null,
}));
mock.module("./share-print-doc-button", () => ({ SharePrintDocButton: () => null }));
mock.module("../../quotes/quote-actions", () => ({
  BookingCreateOrderButton: () => null,
  QuoteDeleteButton: () => null,
}));

const { OrderDetailPanel } = await import("./order-detail-panel.tsx");

async function renderPanel({ compact = false, ...overrides } = {}) {
  const panel = await OrderDetailPanel({
    compact,
    order: {
      id: "order-1",
      code: "DH-260904-063137ZV",
      customerId: "customer-1",
      customerName: "Anh Nhật",
      status: "completed",
      paymentStatus: "paid",
      total: "0",
      amountPaid: "0",
      subtotal: "0",
      discount: "0",
      tax: "0",
      shippingFee: "0",
      createdAt: new Date("2026-09-04T00:00:00Z"),
      items: [],
      payments: [],
      returns: [],
      returnedByItem: {},
      ...overrides,
    },
  });
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "vi", messages, timeZone: "Asia/Ho_Chi_Minh",
  }, panel));
}

describe("order detail customer navigation", () => {
  for (const compact of [false, true]) {
    const view = compact ? "dialog" : "full page";

    test(`${view}: heading and customer card open the customer's detail in a new tab`, async () => {
      const html = await renderPanel({ compact });
      const heading = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/)?.[0];
      expect(heading).toContain('href="/partners?tab=customers&amp;detailCustomerId=customer-1"');
      const customerLinks = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [])
        .filter((link) => link.includes('href="/partners?tab=customers&amp;detailCustomerId=customer-1"'));
      expect(customerLinks).toHaveLength(2);
      for (const link of customerLinks) {
        expect(link).toContain("Anh Nhật");
        expect(link).toContain('target="_blank"');
        expect(link).toContain('rel="noopener noreferrer"');
      }
    });

    test(`${view}: walk-in customers stay plain text without a broken customer link`, async () => {
      const html = await renderPanel({ compact, customerId: null, customerName: null });
      const heading = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/)?.[0];
      expect(heading).toContain(messages.orders.walkIn);
      expect(heading).not.toContain("<a");
      expect(html).not.toContain("detailCustomerId=");
    });
  }
});

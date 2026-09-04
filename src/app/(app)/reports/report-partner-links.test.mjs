import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/vi.json";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {}, push() {} }),
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(),
}));

const { ReportInvoicesTable } = await import("./report-invoices-table.tsx");
const { ReportCustomersTable } = await import("./report-detail-tables.tsx");

const customerId = "7dca0eeb-dc17-4607-8964-18574c2400e9";
const invoice = {
  id: "order-1", code: "DH-1", customerId, customerName: "Anh Nhật", status: "completed",
  createdAt: new Date("2026-09-04T00:00:00Z"), total: 100, cost: 60, profit: 40,
  margin: 40, refund: 0, productCount: 1,
};
const customer = {
  customerId, customerName: "Anh Nhật", customerType: "retail", orderCount: 1,
  segment: "new", revenue: 100, profit: 40, margin: 40, averageOrder: 100, remaining: 20,
};

function render(Component, row) {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "vi", messages, timeZone: "Asia/Ho_Chi_Minh",
  }, createElement(Component, { rows: [row] })));
}

describe("report partner detail links", () => {
  for (const [name, Component, row] of [["invoices", ReportInvoicesTable, invoice], ["customers", ReportCustomersTable, customer]]) {
    test(`${name}: desktop and mobile customer names open the detail modal in a new tab`, () => {
      const html = render(Component, row);
      const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [])
        .filter((link) => link.includes(`detailCustomerId=${customerId}`));
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toContain('href="/partners?tab=customers&amp;detailCustomerId=');
        expect(link).toContain('target="_blank"');
        expect(link).toContain('rel="noopener noreferrer"');
        expect(link).toContain("Anh Nhật");
      }
      for (const button of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []) {
        expect(button).not.toContain(`detailCustomerId=${customerId}`);
      }
    });

    test(`${name}: walk-in customers remain plain text on desktop and mobile`, () => {
      const html = render(Component, { ...row, customerId: null, customerName: "Khách lẻ" });
      expect(html).toContain("Khách lẻ");
      expect(html).not.toContain("detailCustomerId=");
    });
  }
});

import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/vi.json";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("../../purchases/purchase-cancel-button", () => ({ PurchaseCancelButton: () => null }));

const { PurchasesTable } = await import("./purchases-table.tsx");
const { PurchaseReturnsTable } = await import("./purchase-returns-table.tsx");
const row = {
  id: "purchase-1", code: "PN001197", supplierId: "supplier-1", supplierName: "Công ty Duy Hòa",
  createdAt: new Date("2026-09-04T00:00:00Z"), status: "received", settlementStatus: "settled",
  subtotal: "100", total: "100", amountPaid: "100", totalRefund: "100", discount: "0", tax: "0",
  items: [], warehouseName: "Kho chính",
};

describe("inventory supplier navigation", () => {
  for (const Component of [PurchasesTable, PurchaseReturnsTable]) {
    test(`${Component.name}: desktop and mobile labels open the supplier modal in a new tab`, () => {
      const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
        locale: "vi", messages, timeZone: "Asia/Ho_Chi_Minh",
      }, createElement(Component, { rows: [{ ...row, status: Component === PurchaseReturnsTable ? "completed" : "received" }], printTemplates: [] })));
      const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [])
        .filter((link) => link.includes("detailSupplierId=supplier-1"));
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toContain('href="/partners?tab=suppliers&amp;detailSupplierId=supplier-1"');
        expect(link).toContain('target="_blank"');
        expect(link).toContain('rel="noopener noreferrer"');
        expect(link).toContain("Công ty Duy Hòa");
      }
      for (const button of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []) {
        expect(button).not.toContain("detailSupplierId=");
      }
    });
  }
});

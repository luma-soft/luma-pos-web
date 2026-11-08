import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { MobileDocumentRow } = await import("./mobile-document-row.tsx");

test("native-style mobile document rows preserve customer, amount and metadata", () => {
  const html = renderToStaticMarkup(createElement(MobileDocumentRow, {
    customerName: "Khách thử",
    customer: createElement("span", null, "Khách thử"),
    amount: "1.200.000đ",
    code: "BG-001",
    createdAt: "08/11/2026",
    details: createElement("span", null, "Công trình A"),
    onOpen: () => {},
  }));
  expect(html).toContain("Khách thử");
  expect(html).toContain("1.200.000đ");
  expect(html).toContain("BG-001");
  expect(html).toContain("08/11/2026");
  expect(html).toContain("Công trình A");
  expect(html).toContain('aria-label="Khách thử · BG-001"');
  expect(html).toContain('class="absolute inset-0');
  expect(html).not.toContain("undefined");
});

test("mobile document row renders safely without optional details", () => {
  const html = renderToStaticMarkup(createElement(MobileDocumentRow, {
    customerName: "Khách lẻ",
    customer: createElement("span", null, "Khách lẻ"),
    amount: "0đ",
    code: "DH-000",
    createdAt: "08/11/2026",
    onOpen: () => {},
  }));
  expect(html).toContain("Khách lẻ");
  expect(html).toContain("DH-000");
});

test("refund amount can use danger tone while preserving row navigation", () => {
  const html = renderToStaticMarkup(createElement(MobileDocumentRow, {
    customerName: "Khách trả",
    customer: createElement("span", null, "Khách trả"),
    amount: "200.000đ",
    amountTone: "danger",
    code: "TH-002",
    createdAt: "08/11/2026",
    onOpen: () => {},
  }));
  expect(html).toContain("text-er");
  expect(html).toContain("200.000đ");
  expect(html).toContain("Khách trả");
  expect(html).toContain('aria-label="Khách trả · TH-002"');
});

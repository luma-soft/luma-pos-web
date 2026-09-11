import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchDebtSummary } from "./batch-debt-summary";
import { defaultTemplate } from "../../lib/print/template-shared";

const labels = {
  title: "TỔNG HỢP CÔNG NỢ",
  customer: "Khách hàng",
  printedAt: "Ngày in",
  invoice: "Hóa đơn",
  invoiceDate: "Ngày",
  invoiceTotal: "Tiền hàng",
  paid: "Đã trả",
  remaining: "Còn nợ",
  openingDebt: "Công nợ đầu kỳ",
  openingCredit: "Khách trả dư đầu kỳ",
  batchTotal: "Tiền hàng trong kỳ",
  batchPaid: "Đã thanh toán trong kỳ",
  batchRemaining: "Còn nợ phát sinh trong kỳ",
  currentDebt: "CÔNG NỢ CUỐI KỲ",
};

function render(openingDebt) {
  return renderToStaticMarkup(createElement(BatchDebtSummary, {
    template: defaultTemplate("order"),
    size: "a4",
    printedAt: "2026-09-10T08:00:00.000Z",
    labels,
    summary: {
      customerId: "customer-1",
      customerName: "Công ty An Phát",
      invoices: [],
      openingDebt,
      batchTotal: 1_000_000,
      batchPaid: 300_000,
      batchRemaining: 700_000,
      currentDebt: 650_000,
    },
  }));
}

test("credit carried into the selected invoices is explained as a positive amount", () => {
  const html = render(-50_000);
  expect(html).toContain("Khách trả dư đầu kỳ");
  expect(html).toContain("50.000");
  expect(html).not.toContain("-50.000");
  expect(html).toContain("Tiền hàng trong kỳ");
  expect(html).toContain("Đã thanh toán trong kỳ");
  expect(html).toContain("Còn nợ phát sinh trong kỳ");
  expect(html).toContain("CÔNG NỢ CUỐI KỲ");
  expect(html).not.toContain("lô");
});

test("positive prior debt keeps the debt label", () => {
  const html = render(50_000);
  expect(html).toContain("Công nợ đầu kỳ");
  expect(html).not.toContain("Khách trả dư đầu kỳ");
});

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchDebtSummary } from "./batch-debt-summary";
import { defaultTemplate } from "@/lib/print/template-shared";

const labels = {
  title: "TỔNG HỢP CÔNG NỢ",
  customer: "Khách hàng",
  phone: "Điện thoại",
  period: "Kỳ đối chiếu",
  printedAt: "Ngày in",
  index: "STT",
  invoicesSection: "Hóa đơn",
  invoice: "Hóa đơn",
  invoiceDate: "Ngày",
  invoiceTotal: "Tiền hàng",
  paid: "Đã trả",
  remaining: "Còn nợ",
  total: "Tổng cộng",
  movementsSection: "Thanh toán & phát sinh khác trong kỳ",
  movementCode: "Chứng từ",
  movementType: "Nội dung",
  movementAmount: "Số tiền",
  reconciliationSection: "Đối chiếu công nợ",
  openingDebt: "Công nợ đầu kỳ",
  openingCredit: "Khách trả dư đầu kỳ",
  increases: "Phát sinh tăng",
  decreases: "Phát sinh giảm",
  currentDebt: "CÔNG NỢ CUỐI KỲ",
  currentCredit: "KHÁCH TRẢ DƯ CUỐI KỲ",
  inWords: "Bằng chữ",
  customerSign: "Khách hàng",
  sellerSign: "Người lập",
  signHint: "(ký, họ tên)",
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
      customerPhone: null,
      periodStart: "2026-09-01T08:00:00.000Z",
      invoices: [],
      invoiceTotal: 1_000_000,
      invoicePaid: 300_000,
      invoiceRemaining: 700_000,
      movements: [{ id: "m1", code: "DCN1", createdAt: "2026-09-05T08:00:00.000Z", typeLabel: "Điều chỉnh công nợ", value: -20_000 }],
      openingDebt,
      increases: 1_000_000,
      decreases: 320_000,
      currentDebt: openingDebt + 680_000,
    },
  }));
}

test("credit carried into the selected invoices is explained as a positive amount", () => {
  const html = render(-50_000);
  expect(html).toContain("Khách trả dư đầu kỳ");
  expect(html).toContain("50.000");
  expect(html).not.toContain("-50.000");
  expect(html).toContain("Phát sinh tăng");
  expect(html).toContain("Phát sinh giảm");
  expect(html).toContain("Kỳ đối chiếu");
  expect(html).toContain("DCN1");
  expect(html).toContain("CÔNG NỢ CUỐI KỲ");
  expect(html).not.toContain("lô");
});

test("positive prior debt keeps the debt label", () => {
  const html = render(50_000);
  expect(html).toContain("Công nợ đầu kỳ");
  expect(html).not.toContain("Khách trả dư đầu kỳ");
});

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTemplate } from "../../lib/print/template-shared";
import { PrintDoc } from "./print-doc";

function render(size, configure = () => {}) {
  const template = defaultTemplate("order");
  configure(template);
  return renderToStaticMarkup(createElement(PrintDoc, {
    template,
    size,
    title: "Hóa đơn",
    code: "HD001",
    date: "2026-09-10",
    partyLabel: "Khách hàng",
    partyName: "Khách A",
    partyPhone: "0909 000 000",
    deliveryAddress: "12 Nguyễn Trãi",
    items: [
      { id: "line-1", name: "Gạch 30×60", unitName: "m²", quantity: 2, unitPrice: 100000, total: 200000 },
      { id: "line-2", name: "Keo dán gạch", unitName: "bao", quantity: 1, unitPrice: 150000, total: 150000 },
    ],
    totals: [],
    grandTotalLabel: "Tổng cộng",
    grandTotal: 350000,
    paymentQr: {
      title: "Quét mã để thanh toán",
      qrImageUrl: "https://example.com/qr.png",
      bankLabel: "Ngân hàng",
      bankName: "Vietcombank",
      accountNumberLabel: "Tài khoản",
      accountNumber: "0123456789",
    },
    inWordsLabel: "Bằng chữ",
    signatures: ["Khách hàng", "Người giao", "Người lập"],
    cols: { index: "STT", product: "Sản phẩm", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", lineTotal: "Thành tiền" },
  }));
}

for (const size of ["a4", "a5"]) {
  test(`${size} displays a numbered STT column`, () => {
    const html = render(size);
    expect(html).toContain(">STT</th>");
    expect(html).toContain(">1</td>");
    expect(html).toContain(">2</td>");
  });
}

test("K80 keeps the compact table without an STT column", () => {
  expect(render("k80")).not.toContain(">STT</th>");
});

test("saved signature labels override document defaults", () => {
  const html = render("a4", (template) => {
    template.options.signatureLeftLabel = "Người nhận hàng";
    template.options.signatureMiddleLabel = "Thủ kho";
    template.options.signatureRightLabel = "Người bán";
  });

  expect(html).toContain("Người nhận hàng");
  expect(html).toContain("Thủ kho");
  expect(html).toContain("Người bán");
  expect(html).not.toContain(">Người giao</b>");
});

test("batch debt summary is enabled for existing and new templates by default", () => {
  expect(defaultTemplate("order").options.showBatchDebtSummary).toBe(true);
});

test("document defaults only enable payment QR for sales invoices", () => {
  expect(defaultTemplate("order").options.showPaymentQr).toBe(true);
  for (const docType of ["quote", "booking", "purchase", "return", "receipt"]) {
    expect(defaultTemplate(docType).options.showPaymentQr).toBe(false);
  }
});

for (const size of ["a4", "k80"]) {
  test(`${size} receipt uses a money-voucher layout without product columns or QR`, () => {
    const template = defaultTemplate("receipt");
    template.options.showPaymentQr = true;
    const html = render(size, (draft) => Object.assign(draft, template));
    expect(html).not.toContain("print-line-items");
    expect(html).not.toContain("Vietcombank");
    expect(html).toContain("Tổng cộng");
  });
}

for (const size of ["a4", "k80"]) {
  test(`${size} can hide party phone and delivery address independently`, () => {
    const html = render(size, (template) => {
      template.options.showPartyPhone = false;
      template.options.showDeliveryAddress = false;
    });

    expect(html).not.toContain("0909 000 000");
    expect(html).not.toContain("12 Nguyễn Trãi");
  });
}

test("party phone and delivery address stay visible for existing templates", () => {
  const html = render("a4");
  expect(html).toContain("0909 000 000");
  expect(html).toContain("12 Nguyễn Trãi");
});

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTemplate } from "../../lib/print/template-shared";
import { PrintDoc } from "./print-doc";

function renderK80(overrides = {}) {
  const template = defaultTemplate("order");
  return renderToStaticMarkup(createElement(PrintDoc, {
    template,
    size: "k80",
    title: "Hóa đơn",
    code: "HD001",
    date: "2026-09-10",
    partyLabel: "Khách hàng",
    partyName: "Khách lẻ",
    items: [{ id: "line", name: "Gạch Lâm Hưng 30×60", unitName: "m²", quantity: 17, unitPrice: 135000, total: 2295000 }],
    totals: [],
    grandTotalLabel: "Tổng cộng",
    grandTotal: 2295000,
    inWordsLabel: "Bằng chữ",
    cols: { product: "Sản phẩm", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", discount: "Chiết khấu", lineTotal: "Thành tiền" },
    ...overrides,
  }));
}

test("K80 renders line items as a compact semantic table", () => {
  const html = renderK80();

  expect(html).toContain('<table class="print-line-items');
  expect(html).toContain("Sản phẩm");
  expect(html).toContain("SL");
  expect(html).toContain("Đơn giá");
  expect(html).toContain("Thành tiền");
  expect(html).toContain("m²");
  expect(html).toContain("2.295.000");
  expect(html).toContain('class="w-[42%]"');
  expect(html).toContain('class="w-[12%]"');
  expect(html).toContain('class="w-[21%]"');
  expect(html).toContain('class="w-[25%]"');
});

test("K80 keeps the payment QR at a scannable 32mm-class size", () => {
  const html = renderK80({
    paymentQr: {
      title: "Quét để thanh toán",
      qrImageUrl: "https://qr.sepay.vn/img?bank=VCB&acc=0123456789&amount=2295000&des=HD001",
      bankLabel: "Ngân hàng",
      accountLabel: "Tài khoản",
      nameLabel: "Tên",
      referenceLabel: "Nội dung",
      bankName: "Vietcombank",
      accountNumber: "0123456789",
      accountName: "HAI DANG",
      reference: "HD001",
    },
  });

  expect(html).toContain("h-32 w-32 object-contain");
  expect(html).toContain("amount=2295000&amp;des=HD001");
});

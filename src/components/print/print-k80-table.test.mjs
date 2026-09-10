import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTemplate } from "../../lib/print/template-shared";
import { PrintDoc } from "./print-doc";

test("K80 renders line items as a compact semantic table", () => {
  const template = defaultTemplate("order");
  const html = renderToStaticMarkup(createElement(PrintDoc, {
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
  }));

  expect(html).toContain('<table class="print-line-items');
  expect(html).toContain("Sản phẩm");
  expect(html).toContain("SL");
  expect(html).toContain("Đơn giá");
  expect(html).toContain("Thành tiền");
  expect(html).toContain("m²");
  expect(html).toContain("2.295.000");
});

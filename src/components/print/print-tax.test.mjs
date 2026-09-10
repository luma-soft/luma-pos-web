import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTemplate } from "../../lib/print/template-shared";
import { PrintDoc } from "./print-doc";

function render(size, showTax = true) {
  const template = defaultTemplate("order");
  template.options.showTax = showTax;
  return renderToStaticMarkup(createElement(PrintDoc, {
    template,
    size,
    title: "Hóa đơn",
    code: "HD001",
    date: "2026-09-10",
    partyLabel: "Khách hàng",
    partyName: "Khách A",
    items: [{ id: "line", name: "Gạch 30×60", unitName: "m²", quantity: 1, unitPrice: 900000, total: 900000 }],
    totals: [
      { label: "Tạm tính", value: 900000, kind: "subtotal" },
      { label: "Giảm giá", value: 100000, kind: "discount", negative: true },
      { label: "Thuế / VAT", value: 80000, kind: "tax" },
    ],
    grandTotalLabel: "Tổng cộng",
    grandTotal: 880000,
    inWordsLabel: "Bằng chữ",
    cols: { product: "Sản phẩm", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", lineTotal: "Thành tiền" },
  }));
}

for (const size of ["a4", "a5", "k80"]) {
  test(`${size} prints VAT percent together with its amount`, () => {
    const html = render(size);
    expect(html).toContain("Thuế / VAT (10%)");
    expect(html).toContain("80.000");
  });
}

test("VAT option hides both percent and amount", () => {
  const html = render("a4", false);
  expect(html).not.toContain("Thuế / VAT");
  expect(html).not.toContain(">80.000</td>");
});

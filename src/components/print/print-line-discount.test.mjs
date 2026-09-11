import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTemplate } from "../../lib/print/template-shared";
import { PrintDoc } from "./print-doc";

function render(size, showLineDiscount, columnOptions = {}) {
  const template = defaultTemplate("order");
  template.options.showLineDiscount = showLineDiscount;
  Object.assign(template.options, columnOptions);
  return renderToStaticMarkup(createElement(PrintDoc, {
    template, size, title: "Hóa đơn", code: "HD001", date: "2026-09-04", partyLabel: "Khách hàng", partyName: "Khách lẻ",
    items: [{ id: "line", name: "Ống Tiền Phong", unitName: "cây", quantity: 3, unitPrice: 100000, discount: 60000, lineDiscountMode: "pct", lineDiscountValue: 20, total: 240000 }],
    totals: [], grandTotalLabel: "Tổng cộng", grandTotal: 240000, inWordsLabel: "Bằng chữ",
    cols: { product: "Sản phẩm", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", discount: "Chiết khấu", lineTotal: "Thành tiền" },
  }));
}

for (const size of ["a4", "k80"]) {
  test(`${size} shows original unit price, percent and TOTAL line discount`, () => {
    const html = render(size, true);
    expect(html).toContain("100.000");
    expect(html).toContain("60.000");
    expect(html).toContain("20%");
    expect(html).toContain("240.000");
  });
  test(`${size} hidden discount uses net unit price so printed arithmetic stays correct`, () => {
    const html = render(size, false);
    expect(html).toContain("80.000");
    expect(html).not.toContain("100.000");
    expect(html).not.toContain("60.000");
    expect(html).not.toContain("20%");
  });
}

test("a4 controls discount percent and amount as separate columns", () => {
  const percentOnly = render("a4", true, { showLineDiscountPercent: true, showLineDiscountAmount: false });
  expect(percentOnly).toContain("% CK");
  expect(percentOnly).toContain("20%");
  expect(percentOnly).not.toContain("Tiền CK");
  expect(percentOnly).not.toContain("60.000");

  const amountOnly = render("a4", true, { showLineDiscountPercent: false, showLineDiscountAmount: true });
  expect(amountOnly).not.toContain("% CK");
  expect(amountOnly).not.toContain("20%");
  expect(amountOnly).toContain("Tiền CK");
  expect(amountOnly).toContain("60.000");
});

test("k80 preview respects the separate line discount controls", () => {
  const percentOnly = render("k80", true, { showLineDiscountPercent: true, showLineDiscountAmount: false });
  expect(percentOnly).toContain("Chiết khấu: 20%");
  expect(percentOnly).not.toContain("60.000");

  const amountOnly = render("k80", true, { showLineDiscountPercent: false, showLineDiscountAmount: true });
  expect(amountOnly).toContain("Chiết khấu: −60.000");
  expect(amountOnly).not.toContain("20%");
});

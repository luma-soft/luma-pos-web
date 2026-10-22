import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultTemplate } from "../../lib/print/template-shared";
import { PrintDoc } from "./print-doc";

function render(size) {
  return renderToStaticMarkup(createElement(PrintDoc, {
    template: defaultTemplate("quote"),
    size,
    title: "Báo giá",
    code: "BG-261022-14140732",
    date: "2026-10-21",
    partyLabel: "Khách hàng",
    partyName: "Khách A",
    items: [{
      id: "pvc-140-c2",
      name: "Ống Nhựa PVC Tiền Phong",
      variantName: "140 / C2",
      specs: { SIZE: ["140"], "LOẠI ỐNG": ["C2"] },
      unitName: "m",
      quantity: 28,
      unitPrice: 147339,
      total: 4125492,
    }],
    totals: [{ label: "Tạm tính", value: 4125492, kind: "subtotal" }],
    grandTotalLabel: "Tổng cộng",
    grandTotal: 4125492,
    inWordsLabel: "Bằng chữ",
    cols: { product: "Sản phẩm", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", lineTotal: "Thành tiền" },
  }));
}

for (const size of ["a4", "a5", "k80"]) {
  test(`${size} print preserves variant attributes missing from the saved product name`, () => {
    expect(render(size)).toContain("Ống Nhựa PVC Tiền Phong · 140 / C2");
  });
}

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { AiAttachmentCandidate } from "./provider";
import {
  buildPosImageProductLines,
  mergeAlternativeProductLines,
  posImageProductLookupValues,
} from "./pos-image-cart";

const product = (id: string, sku: string, name: string) => ({
  id,
  sku,
  barcode: null,
  name,
  baseUnit: "Cái",
  costPrice: 0,
  lastPurchasePrice: 0,
  retailPrice: 0,
  categoryId: null,
  brandId: null,
  minStock: 0,
  units: [],
  supplierSkus: [],
});

const candidate = (
  text: string,
  quantity: number,
  unitCost: number,
  lineTotal: number,
  sku: string | null = null,
): AiAttachmentCandidate => ({
  text,
  sku,
  unitName: "Cái",
  quantity,
  unitCost,
  grossUnitCost: unitCost,
  discount: 0,
  discountRate: 0,
  lineTotal,
  confidence: 0.96,
});

describe("POS image cart structured rows", () => {
  test("keeps receipt quantities instead of treating STT and prices as quantities", () => {
    const products = [
      product("wire", "SP003038", "Dây điện CADISUN - 2*1.0"),
      product("faceplate", "SP000933", "Mặt Pana 2 lỗ WIDE 68020"),
      product("holder", "SP000871", "Đui treo"),
      product("base", "SP002512", "Đế Đơn Nổi Sino"),
      product("socket", "SP000928", "Hạt Pana ổ cắm đơn có màn che WIDE 1081 - 7SW"),
      product("switch", "SP000929", "Hạt Pana công tắc 1 chiều WIDE 5001 - 7SW"),
      product("bulb", "SP053199", "Bóng Trụ 3S - 40W"),
      product("switch-2", "SP000930", "Hạt Pana công tắc 2 chiều WIDE 5002 - 7SW"),
      product("wire-other", "SP000936", "Dây điện TACHIKO - 2*0.75 L2"),
      product("wire-similar", "SP003032", "Dây điện CADISUN - 1*1.0"),
    ];
    const candidates = [
      candidate("Dây điện CADISUN - 2*1.0 (m)", 20, 12000, 240000),
      candidate("Mặt Pana 2 lỗ WIDE 68020", 1, 14000, 14000, "68020"),
      candidate("Đui treo", 1, 8000, 8000),
      candidate("Đế Đơn Nổi Sino", 1, 7000, 7000),
      candidate("Hạt Pana ổ cắm đơn có màn che WIDE 1081 - 7SW", 1, 28000, 28000, "1081"),
      candidate("Hạt Pana công tắc 1 chiều WIDE 5001 - 7SW", 1, 17000, 17000, "5001"),
      candidate("Bóng Trụ 3S - 40W", 1, 75000, 75000),
    ];

    const result = buildPosImageProductLines(candidates, products);

    assert.deepEqual(result.unresolvedItems, []);
    assert.deepEqual(result.lines.map((line) => [line.product.sku, line.quantity]), [
      ["SP003038", 20],
      ["SP000933", 1],
      ["SP000871", 1],
      ["SP002512", 1],
      ["SP000928", 1],
      ["SP000929", 1],
      ["SP053199", 1],
    ]);
  });

  test("derives a missing quantity only from the structured row arithmetic", () => {
    const products = [product("wire", "SP003038", "Dây điện CADISUN - 2*1.0")];
    const row = candidate("Dây điện CADISUN - 2*1.0", 20, 12000, 240000);
    row.quantity = null;

    assert.equal(buildPosImageProductLines([row], products).lines[0]?.quantity, 20);
  });

  test("builds one focused catalog query per OCR row and removes a printed unit suffix", () => {
    const rows = [
      candidate("Dây điện CADISUN - 2*1.0 (m)", 20, 12000, 240000),
      candidate("Hạt Pana công tắc 1 chiều WIDE 5001 - 7SW", 1, 17000, 17000, "5001"),
    ];

    assert.deepEqual(posImageProductLookupValues(rows), [
      "Dây điện CADISUN - 2*1.0",
      "Hạt Pana công tắc 1 chiều WIDE 5001 - 7SW",
    ]);
  });
});

describe("POS text fallback", () => {
  test("does not add the same quantity from exact and segmented matching", () => {
    const switchProduct = product(
      "switch",
      "SP000929",
      "Hạt Pana công tắc 1 chiều WIDE 5001 - 7SW",
    );
    const result = mergeAlternativeProductLines(
      [{ product: switchProduct, quantity: 2, confidence: 0.86 }],
      [{ product: switchProduct, quantity: 2, confidence: 0.82 }],
    );

    assert.equal(result[0]?.quantity, 2);
  });
});

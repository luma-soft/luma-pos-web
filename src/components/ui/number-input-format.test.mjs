import { expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { NumberInput } from "./number-input";
import { QuantityInput, normalizeQuantity, stepQuantity } from "./quantity-input";
import { parseNumberInput } from "./number-input-format";
import { positiveQuantityOrDefault } from "@/lib/quantity";
import { orderItemSchema, purchaseItemSchema } from "@/lib/schemas/order";
import { internalUseItemSchema } from "@/lib/schemas/internal-use";
import { purchaseReturnItemSchema } from "@/lib/schemas/purchase-returns";

for (const thousandSeparator of [false, true]) {
  test(`fractional input accepts dot/comma with grouping=${thousandSeparator}`, () => {
    for (const [text, expected] of [["0.5", 0.5], ["1.5", 1.5], ["0,5", 0.5], ["1,5", 1.5], [".5", 0.5], ["1.", 1], ["0.0001", 0.0001], ["1.234,5", 1234.5], ["1,234.5", 1234.5]]) {
      expect(parseNumberInput(text, { thousandSeparator, decimals: 4 })).toBe(expected);
    }
    for (const text of ["", "-", "1.2.3", "1,2,3", "NaN", "Infinity", "1x5"]) {
      expect(parseNumberInput(text, { thousandSeparator, decimals: 4 })).toBeNull();
    }
  });
}

test("integer-mode localized grouping remains compatible", () => {
  expect(parseNumberInput("1.234.567")).toBe(1234567);
});

test("fractional quantities render and submit without localized-string loss", () => {
  const render = (component) => renderToStaticMarkup(React.createElement(NextIntlClientProvider, { locale: "vi", messages: {}, timeZone: "Asia/Ho_Chi_Minh" }, component));
  const html = render(React.createElement(NumberInput, { name: "quantity", defaultValue: 0.5, decimals: 4 }));
  expect(html).toContain('type="hidden" name="quantity" value="0.5"');
  expect(html).toContain('value="0,5"');
  const quantity = render(React.createElement(QuantityInput, { value: 0.5, onChange() {} }));
  expect(quantity).toContain('inputMode="decimal"');
  expect(quantity).toContain('value="0.5"');
  expect(normalizeQuantity(0.5)).toBe(0.5);
  expect(normalizeQuantity(1.2345)).toBe(1.2345);
  expect(stepQuantity(0.5, 1)).toBe(1);
});

test("quantity input uses one integrated focus border", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      NextIntlClientProvider,
      { locale: "vi", messages: {}, timeZone: "Asia/Ho_Chi_Minh" },
      React.createElement(QuantityInput, {
        value: 1,
        decimals: 0,
        onChange() {},
      }),
    ),
  );

  expect(html).toContain("focus-within:border-primary-600");
  expect(html).toContain("border-r border-border");
  expect(html).toContain("border-l border-border");
  expect(html).toContain("border-0");
  expect(html).toContain("focus:border-transparent");
  expect(html).not.toContain("rounded-none border-y-0");
});

test("imported quantities preserve fractions and reject non-finite/invalid numbers", () => {
  for (const value of [0.5, "0.5", 1.5, "1.5"]) expect(positiveQuantityOrDefault(value)).toBe(Number(value));
  for (const value of [0, -1, null, undefined, Infinity, "not a number"]) expect(positiveQuantityOrDefault(value)).toBe(1);
});

test("business item schemas preserve fractional quantities for ordinary units", () => {
  const productId = "00000000-0000-4000-8000-000000000001";
  for (const quantity of [0.5, 1.5, 0.0001]) {
    const item = { productId, productName: "Dây", unitName: "cái", unitMultiplier: 1, quantity, unitCost: 4000, returnUnitCost: 4000 };
    for (const schema of [orderItemSchema, purchaseItemSchema, internalUseItemSchema, purchaseReturnItemSchema]) {
      expect(schema.parse(item).quantity).toBe(quantity);
    }
  }
});

import { expect, test } from "bun:test";
import { defaultOptionsForDocType, normalizeLineDiscountOptions, updateLineDiscountOption } from "./template-shared";

test("enabling product discounts restores both default columns when neither is selected", () => {
  const options = {
    ...defaultOptionsForDocType("order"),
    showLineDiscount: false,
    showLineDiscountPercent: false,
    showLineDiscountAmount: false,
  };

  expect(updateLineDiscountOption(options, "showLineDiscount", true)).toMatchObject({
    showLineDiscount: true,
    showLineDiscountPercent: true,
    showLineDiscountAmount: true,
  });
});

test("turning off the last product discount column also turns off its parent option", () => {
  const options = {
    ...defaultOptionsForDocType("order"),
    showLineDiscount: true,
    showLineDiscountPercent: true,
    showLineDiscountAmount: false,
  };

  expect(updateLineDiscountOption(options, "showLineDiscountPercent", false)).toMatchObject({
    showLineDiscount: false,
    showLineDiscountPercent: false,
    showLineDiscountAmount: false,
  });
});

test("legacy product discount settings are normalized when templates are loaded or saved", () => {
  const options = {
    ...defaultOptionsForDocType("order"),
    showLineDiscount: true,
    showLineDiscountPercent: false,
    showLineDiscountAmount: false,
  };

  expect(normalizeLineDiscountOptions(options)).toMatchObject({
    showLineDiscount: true,
    showLineDiscountPercent: true,
    showLineDiscountAmount: true,
  });
});

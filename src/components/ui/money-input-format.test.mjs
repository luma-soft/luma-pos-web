import { expect, test } from "bun:test";
import { formatMoneyInput, parseMoneyInput, readMoneyInput } from "./money-input-format";

test("opt-in decimal money survives editing and blur", () => {
  for (const price of [33.33, 11491.17, 0, 1000000.05]) {
    expect(parseMoneyInput(formatMoneyInput(price, 2), false, 2)).toBe(price);
  }
  expect(parseMoneyInput("", false, 2)).toBeNull();
  expect(parseMoneyInput("0", false, 2)).toBe(0);
  expect(parseMoneyInput("1,2,3", false, 2)).toBeNull();
});

test("invalid nonempty input cannot be interpreted as clearing a price", () => {
  expect(readMoneyInput("1,2,3", false, 2)).toEqual({ valid: false });
  expect(readMoneyInput("abc", false, 2)).toEqual({ valid: false });
  expect(readMoneyInput("", false, 2)).toEqual({ valid: true, value: null });
  expect(readMoneyInput("0", false, 2)).toEqual({ valid: true, value: 0 });
});

test("existing integer inputs preserve their digit-only contract", () => {
  expect(parseMoneyInput("1.234")).toBe(1234);
  expect(parseMoneyInput("-1.234", true)).toBe(-1234);
  expect(formatMoneyInput(1234)).toBe("1.234");
});

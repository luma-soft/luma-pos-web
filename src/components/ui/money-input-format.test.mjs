import { expect, test } from "bun:test";
import { formatMoneyInput, formatMoneyInputDraft, moneyInputCaret, moneyInputEditText, parseMoneyInput, readMoneyInput } from "./money-input-format";

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

test("groups money while typing and keeps an unfinished decimal fraction", () => {
  expect(formatMoneyInputDraft("100000")).toBe("100.000");
  expect(formatMoneyInputDraft("100000", false, 2)).toBe("100.000");
  expect(formatMoneyInputDraft("100000,", false, 2)).toBe("100.000,");
  expect(formatMoneyInputDraft("100000,0", false, 2)).toBe("100.000,0");
  expect(formatMoneyInputDraft("100000,05", false, 2)).toBe("100.000,05");
  expect(formatMoneyInputDraft("-100000,05", true, 2)).toBe("-100.000,05");
  expect(formatMoneyInputDraft("", false, 2)).toBe("");
  expect(formatMoneyInputDraft("-", true, 2)).toBe("-");
});

test("keeps the caret beside the edited digits when grouping changes", () => {
  expect(moneyInputCaret("1000", "1.000", 4)).toBe(5);
  expect(moneyInputCaret("125.345", "125.345", 3)).toBe(3);
  expect(moneyInputCaret("12.34", "1.234", 3)).toBe(3);
  expect(moneyInputCaret("100000,0", "100.000,0", 8)).toBe(9);
  expect(moneyInputCaret("33.", "33,", 3)).toBe(3);
});

test("pasted canonical decimals and Vietnamese amounts keep the same numeric value", () => {
  expect(parseMoneyInput("33.33", false, 2)).toBe(33.33);
  expect(formatMoneyInputDraft("33.33", false, 2)).toBe("33,33");
  expect(parseMoneyInput("1.234", false, 2)).toBe(1234);
  expect(parseMoneyInput("1.234,50", false, 2)).toBe(1234.5);
  expect(parseMoneyInput("1.234,50 ₫", false, 2)).toBe(1234.5);
  expect(parseMoneyInput("100,000")).toBe(100000);
  expect(parseMoneyInput("-33.33", true, 2)).toBe(-33.33);
});

test("malformed amounts never silently become another numeric amount", () => {
  for (const input of ["abc", "12abc3", "1.23.45", "1,2,3", "123,4567"]) {
    expect(readMoneyInput(input, false, 2)).toEqual({ valid: false });
  }
  expect(readMoneyInput("12abc3")).toEqual({ valid: false });
  expect(readMoneyInput("33.33")).toEqual({ valid: false });
});

test("individual keystrokes and deletion regroup existing separators without treating them as decimals", () => {
  expect(formatMoneyInputDraft(moneyInputEditText("1.0000", "1.000", "insertText", "0"))).toBe("10.000");
  expect(formatMoneyInputDraft(moneyInputEditText("100.00", "100.000", "deleteContentBackward", null))).toBe("10.000");
  expect(formatMoneyInputDraft(moneyInputEditText("1.5234,50", "1.234,50", "insertText", "5"), false, 2)).toBe("15.234,50");
  expect(formatMoneyInputDraft(moneyInputEditText("1.00", "1.000", "deleteContentBackward", null), false, 2)).toBe("100");
  expect(moneyInputEditText("33.33", "1.000", "insertFromPaste", null, 2)).toBe("33.33");
});

import { describe, expect, test } from "bun:test";
import { resolveRevenueBook } from "./revenue-book.ts";

describe("resolveRevenueBook", () => {
  test.each([
    ["non_taxable", "S1a-HKD"],
    ["revenue_percentage", "S2a-HKD"],
    ["taxable_income", "S2b-HKD"],
  ])("maps %s to %s", (method, code) => {
    expect(resolveRevenueBook(method)?.code).toBe(code);
  });

  test("requires tax setup before selecting a statutory book", () => {
    expect(resolveRevenueBook("unconfigured")).toBeNull();
  });
});

import { describe, expect, it } from "bun:test";
import { normalizeQuantity } from "@/components/ui/quantity-input";

describe("shared quantity input", () => {
  it("clamps quantities to their allowed range", () => {
    expect(normalizeQuantity(-2, { min: 0 })).toBe(0);
    expect(normalizeQuantity(12, { min: 0, max: 10 })).toBe(10);
    expect(normalizeQuantity(2, { min: 0, max: -1 })).toBe(2);
  });

  it("keeps supported decimal quantities stable", () => {
    expect(normalizeQuantity(1.23456, { decimals: 4 })).toBe(1.2346);
    expect(normalizeQuantity(Number.NaN, { min: 0.0001 })).toBe(0.0001);
  });
});

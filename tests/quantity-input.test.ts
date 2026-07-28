import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  QuantityInput,
  normalizeQuantity,
  stepQuantity,
} from "@/components/ui/quantity-input";

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

  it("does not jump from one to a fractional minimum when decreasing", () => {
    expect(stepQuantity(1, -1, { min: 0.0001, step: 1 })).toBe(1);
    expect(stepQuantity(0.0001, 1, { min: 0.0001, step: 1 })).toBe(1);
    expect(stepQuantity(1.0001, -1, { min: 0.0001, step: 1 })).toBe(1);
  });

  it("supports large touch targets and product-specific accessible labels", () => {
    const markup = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: "en", messages: {}, timeZone: "UTC" },
        createElement(QuantityInput, {
          value: 2,
          onChange: () => undefined,
          touchTargets: true,
          decrementLabel: "Decrease quantity for Camera H6C",
          inputLabel: "Quantity for Camera H6C",
          incrementLabel: "Increase quantity for Camera H6C",
        }),
      ),
    );

    expect(markup).toContain("grid-cols-[44px_minmax(44px,1fr)_44px]");
    expect(markup).toContain('aria-label="Decrease quantity for Camera H6C"');
    expect(markup).toContain('aria-label="Quantity for Camera H6C"');
    expect(markup).toContain('aria-label="Increase quantity for Camera H6C"');
  });
});

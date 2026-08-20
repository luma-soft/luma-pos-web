import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PosStockQuantityTooltip } from "@/components/pos/pos-summary-controls";
import { resolvePosCartUnit } from "@/lib/pos/cart-unit";

describe("POS cart units", () => {
  test("defaults a multi-unit product to its base unit", () => {
    expect(resolvePosCartUnit("m", [
      { unitName: "cuộn", multiplier: "305", priceOverride: "2500000" },
    ])).toEqual({
      unitName: "m",
      unitMultiplier: 1,
      alternateUnit: null,
    });
  });

  test("resolves an explicitly selected alternate unit", () => {
    const roll = { unitName: "cuộn", multiplier: "305", priceOverride: "2500000" };

    expect(resolvePosCartUnit("m", [roll], "cuộn")).toEqual({
      unitName: "cuộn",
      unitMultiplier: 305,
      alternateUnit: roll,
    });
  });

  test("explains the cart demand separately from reserved stock", () => {
    const markup = renderToStaticMarkup(
      <PosStockQuantityTooltip
        stock={168}
        ordered={75 * 305}
        reserved={0}
        unit="m"
      />,
    );

    expect(markup).toContain("Tồn: 168 m");
    expect(markup).toContain("Trong đơn: 22.875 m");
    expect(markup).toContain("Đã giữ: 0 m");
  });
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildPosUnitOptions,
  PosCartScrollSurface,
  PosSearchQuantitySlot,
  PosSearchResultLayout,
  posUnitSuffix,
} from "@/components/pos/pos-mobile-layout";

describe("POS mobile search results", () => {
  test("moves quantity and price controls onto a bounded row instead of collapsing the product name", () => {
    const markup = renderToStaticMarkup(
      <PosSearchResultLayout
        selected
        leading={<span>Ảnh</span>}
        summary={<span>Ấm Siêu Tốc Electric kettle đẹp</span>}
        controls={(
          <>
            <button type="button">− 1 +</button>
            <span>300.000 đ/cái</span>
          </>
        )}
      />,
    );

    expect(markup).toContain("grid-cols-[36px_minmax(0,1fr)]");
    expect(markup).toContain("col-span-2");
    expect(markup).toContain("min-w-0");
    expect(markup).toContain("sm:flex");
    expect(markup).toContain("sm:w-auto");
    expect(markup).not.toContain("sm:w-64");
    expect(markup).not.toContain("w-auto sm:w-64 shrink-0");
  });

  test("reserves all three 44px quantity tracks until the desktop breakpoint", () => {
    const markup = renderToStaticMarkup(
      <PosSearchQuantitySlot>
        <span>− 1 +</span>
      </PosSearchQuantitySlot>,
    );

    expect(markup).toContain("w-[8.25rem]");
    expect(markup).toContain("lg:w-28");
    expect(markup).not.toContain('class="w-28"');
  });
});

describe("POS mobile unit controls", () => {
  test("omits blank units instead of creating an empty select option", () => {
    expect(buildPosUnitOptions("", [
      { unitName: "", multiplier: 1, barcode: null, priceOverride: null },
      { unitName: "  ", multiplier: 2, barcode: null, priceOverride: null },
    ])).toEqual([]);
    expect(posUnitSuffix("")).toBe("");
  });

  test("keeps valid base and alternate units without duplicates", () => {
    expect(buildPosUnitOptions("cái", [
      { unitName: " cái ", multiplier: 1, barcode: null, priceOverride: null },
      { unitName: "hộp", multiplier: 10, barcode: null, priceOverride: null },
    ])).toEqual([
      { value: "cái", label: "cái" },
      { value: "hộp", label: "hộp" },
    ]);
    expect(posUnitSuffix("cái")).toBe("/cái");
  });
});

describe("POS mobile checkout", () => {
  test("owns a constrained vertical scroll region so the payment button remains reachable", () => {
    const markup = renderToStaticMarkup(
      <PosCartScrollSurface>
        <button type="button">Thanh toán</button>
      </PosCartScrollSurface>,
    );

    expect(markup).toContain("h-full");
    expect(markup).toContain("min-h-0");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("overscroll-contain");
    expect(markup).toContain("lg:overflow-hidden");
    expect(markup).toContain(">Thanh toán</button>");
  });
});

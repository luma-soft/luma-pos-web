import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildPosUnitOptions,
  PosCartScrollSurface,
  PosQuantitySlot,
  PosSearchResultLayout,
  PosSearchResultsSurface,
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

  test("reserves all three 44px quantity tracks at every POS breakpoint", () => {
    const markup = renderToStaticMarkup(
      <PosQuantitySlot>
        <span>− 1 +</span>
      </PosQuantitySlot>,
    );

    expect(markup).toContain("w-[8.25rem]");
    expect(markup).not.toContain("lg:w-28");
    expect(markup).not.toContain('class="w-28"');
  });

  test("keeps search results scrollable without exposing a native scrollbar", () => {
    const markup = renderToStaticMarkup(
      <PosSearchResultsSurface>
        <div>Sản phẩm</div>
      </PosSearchResultsSurface>,
    );

    expect(markup).toContain("overflow-auto");
    expect(markup).toContain("[scrollbar-width:none]");
    expect(markup).toContain("[&amp;::-webkit-scrollbar]:hidden");
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

  test("keeps cart line actions and notes at least 44px tall on mobile", () => {
    const source = readFileSync(
      "src/app/(pos)/pos/pos-client.tsx",
      "utf8",
    );

    expect(source).toContain(
      'className="grid h-11 w-11 shrink-0 place-items-center rounded-lg',
    );
    expect(source).toContain(
      'className="flex min-h-11 items-center text-sm tabular-nums',
    );
    expect(source).toContain(
      'className="mt-2 min-h-11 w-full bg-transparent',
    );
    expect(source).toContain(
      'className="grid h-11 w-11 place-items-center rounded',
    );
  });

  test("keeps POS search and nested modal controls touch-safe on mobile", () => {
    const source = readFileSync(
      "src/app/(pos)/pos/pos-client.tsx",
      "utf8",
    );

    expect(source).toContain(
      'className="absolute right-16 top-1/2 z-10 grid h-11 w-11',
    );
    expect(source).toContain(
      'className="flex min-h-11 items-center gap-1.5',
    );
    expect(source).toContain(
      'className="flex min-h-11 w-full items-center gap-2',
    );
    expect(source).toContain(
      'className="grid h-11 w-11 place-items-center rounded-lg text-slate-400',
    );
    expect(source).toContain(
      'className="flex-1 min-h-11 py-2 rounded-lg',
    );
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('aria-labelledby="pos-price-editor-title"');
  });
});

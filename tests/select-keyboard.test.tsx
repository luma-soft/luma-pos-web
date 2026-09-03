import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Select, SelectOptionRow, selectFocusIndex } from "@/components/ui/select";

describe("shared select keyboard navigation", () => {
  test("arrow keys move through options and wrap at both ends", () => {
    expect(selectFocusIndex("ArrowDown", 0, 3)).toBe(1);
    expect(selectFocusIndex("ArrowUp", 2, 3)).toBe(1);
    expect(selectFocusIndex("ArrowDown", 2, 3)).toBe(0);
    expect(selectFocusIndex("ArrowUp", 0, 3)).toBe(2);
  });

  test("entering from the trigger/search starts at the appropriate end", () => {
    expect(selectFocusIndex("ArrowDown", -1, 3)).toBe(0);
    expect(selectFocusIndex("ArrowUp", -1, 3)).toBe(2);
  });

  test("Home and End reach the first and last options", () => {
    expect(selectFocusIndex("Home", 2, 3)).toBe(0);
    expect(selectFocusIndex("End", 0, 3)).toBe(2);
  });

  test("empty options and unrelated keys do not select a phantom item", () => {
    expect(selectFocusIndex("ArrowDown", -1, 0)).toBe(-1);
    expect(selectFocusIndex("End", -1, 0)).toBe(-1);
    expect(selectFocusIndex("Enter", 1, 3)).toBeNull();
    expect(selectFocusIndex("a", 1, 3)).toBeNull();
  });

  test("option rows expose selection, programmatic focus and a visible keyboard focus treatment", () => {
    const html = renderToStaticMarkup(createElement(SelectOptionRow, {
      active: true, wrapLabel: false, onSelect: () => undefined, label: "Đèn thả",
    }));
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("focus-visible:outline-primary-600");
  });

  test("the trigger remains a labeled, form-compatible custom button", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={{}} timeZone="UTC">
        <Select name="album" value="lighting" aria-label="Album"
          options={[{ value: "lighting", label: "Đèn trang trí" }]} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Album"');
    expect(html).toContain('type="hidden" name="album" value="lighting"');
    expect(html).not.toContain("<select");
  });
});

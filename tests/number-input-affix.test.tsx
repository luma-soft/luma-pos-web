import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { NumberInput } from "@/components/ui/number-input";

function renderNumberInput(suffix: string) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "vi", messages: {}, timeZone: "Asia/Ho_Chi_Minh" },
      createElement(NumberInput, {
        value: 10_000,
        suffix,
        "aria-label": "Giá bán lẻ",
      }),
    ),
  );
}

describe("NumberInput affixes", () => {
  test("keeps a short currency suffix close to the numeric value", () => {
    const markup = renderNumberInput("đ");

    expect(markup).toContain('value="10.000"');
    expect(markup).toContain("padding-right:calc(1rem + 1ch)");
    expect(markup).not.toContain("pr-14");
  });

  test("reserves more room for a longer suffix without restoring a fixed gap", () => {
    expect(renderNumberInput("ngày")).toContain(
      "padding-right:calc(1rem + 4ch)",
    );
  });
});

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoneyInput } from "@/components/ui/money-input";

test("MoneyInput formats VND while staying touch-safe through tablet", () => {
  const html = renderToStaticMarkup(
    createElement(MoneyInput, {
      value: 1234567,
      "aria-label": "Amount",
      className: "w-full",
    }),
  );

  expect(html).toContain('value="1.234.567"');
  expect(html).toContain("min-h-11");
  expect(html).toContain("min-w-11");
  expect(html).toContain("lg:min-h-0");
  expect(html).toContain("lg:min-w-0");
  expect(html).toContain("w-full");
  expect(html).toContain('inputMode="numeric"');
});

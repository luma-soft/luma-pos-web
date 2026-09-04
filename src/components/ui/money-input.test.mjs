import { expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoneyInput } from "./money-input";

test("named money fields display grouped values and submit an unformatted decimal", () => {
  const html = renderToStaticMarkup(React.createElement(MoneyInput, { name: "price", defaultValue: 123456.75, decimals: 2, suffix: "đ/m" }));
  expect(html).toContain('type="hidden" name="price" value="123456.75"');
  expect(html).toContain('value="123.456,75"');
  expect(html.match(/name="price"/g)).toHaveLength(1);
  expect(html).toContain("đ/m");
});

test("empty, zero and negative money retain their form values", () => {
  for (const [value, numeric, display] of [[null, "", ""], [0, "0", "0"], [-100000, "-100000", "-100.000"]]) {
    const html = renderToStaticMarkup(React.createElement(MoneyInput, { name: "amount", value, min: -1000000 }));
    expect(html).toContain(`type="hidden" name="amount" value="${numeric}"`);
    expect(html).toContain(`value="${display}"`);
  }
});

test("disabled and externally associated money fields follow native form submission", () => {
  const html = renderToStaticMarkup(React.createElement(MoneyInput, { name: "price", defaultValue: 100000, disabled: true, form: "label-form" }));
  const hidden = html.match(/<input[^>]*type="hidden"[^>]*>/)?.[0];
  expect(hidden).toContain('name="price"');
  expect(hidden).toContain('value="100000"');
  expect(hidden).toContain('disabled=""');
  expect(hidden).toContain('form="label-form"');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html.match(/form="label-form"/g)).toHaveLength(2);
});

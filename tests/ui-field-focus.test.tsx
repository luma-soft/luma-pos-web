import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchableSelect } from "@/components/combobox";

function renderField(field: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      {
        locale: "vi",
        messages: {},
        timeZone: "Asia/Ho_Chi_Minh",
      },
      field,
    ),
  );
}

describe("shared form field focus treatment", () => {
  test("uses one primary border without a second focus ring", () => {
    const fields = [
      renderField(createElement(Input, { "aria-label": "Tên" })),
      renderField(createElement(Textarea, { "aria-label": "Ghi chú" })),
      renderField(
        createElement(Select, {
          "aria-label": "Trạng thái",
          options: [{ value: "active", label: "Đang sử dụng" }],
          value: "active",
        }),
      ),
    ];

    for (const html of fields) {
      expect(html).toContain("focus:border-primary-600");
      expect(html).toContain("focus:outline-none");
      expect(html).not.toContain("focus:ring-2");
    }
  });

  test("keeps error focus on one red border", () => {
    const fields = [
      renderField(createElement(Input, { "aria-label": "Tên", variant: "error" })),
      renderField(createElement(Textarea, { "aria-label": "Ghi chú", variant: "error" })),
      renderField(
        createElement(Select, {
          "aria-label": "Trạng thái",
          options: [],
          variant: "error",
        }),
      ),
    ];

    for (const html of fields) {
      expect(html).toContain("focus:border-red-500");
      expect(html).not.toContain("focus:ring-2");
      expect(html).not.toContain("focus:ring-red-500");
    }
  });

  test("identifies searchable selectors as dropdown triggers", () => {
    const html = renderField(
      createElement(SearchableSelect, {
        value: "active",
        onChange: () => undefined,
        options: [{ value: "active", label: "Đang sử dụng" }],
      }),
    );

    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
  });
});

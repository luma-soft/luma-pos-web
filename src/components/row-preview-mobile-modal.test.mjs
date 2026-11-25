import { test, expect, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

const { RowPreviewModal } = await import("./data-table.tsx");

test("mobile detail panel respects safe areas while desktop geometry stays intact", () => {
  const html = renderToStaticMarkup(createElement(RowPreviewModal, {
    title: "Chi tiết",
    open: true,
    onClose() {},
    footer: createElement("span", null, "Hoàn tất"),
  }, createElement("p", null, "Nội dung")));
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain("safe-area-inset-top");
  expect(html).toContain("sm:max-h-[900px]");
  expect(html).toContain("sm:max-w-[1600px]");
  expect(html).toContain("safe-area-inset-bottom");
});

test("modal is not rendered while closed", () => {
  expect(renderToStaticMarkup(createElement(RowPreviewModal, {
    title: "Chi tiết", open: false, onClose() {},
  }, "hidden"))).toBe("");
});

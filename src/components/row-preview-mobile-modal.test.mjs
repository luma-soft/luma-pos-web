import { test, expect, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));

const { RowPreviewModal, shouldCloseRowPreviewOnEscape } = await import("./data-table.tsx");
const first = {};
const top = {};

test("Escape dismisses only the topmost modal", () => {
  expect(shouldCloseRowPreviewOnEscape({ key: "Escape", defaultPrevented: false }, first, [first, top])).toBe(false);
  expect(shouldCloseRowPreviewOnEscape({ key: "Escape", defaultPrevented: false }, top, [first, top])).toBe(true);
  expect(shouldCloseRowPreviewOnEscape({ key: "Escape", defaultPrevented: true }, top, [first, top])).toBe(false);
  expect(shouldCloseRowPreviewOnEscape({ key: "Tab", defaultPrevented: false }, top, [first, top])).toBe(false);
  expect(shouldCloseRowPreviewOnEscape({ key: "Escape", defaultPrevented: false }, null, [])).toBe(false);
});

test("mobile detail panel respects safe areas while desktop geometry stays intact", () => {
  const html = renderToStaticMarkup(createElement(RowPreviewModal, {
    title: "Chi tiết",
    open: true,
    onClose() {},
    footer: createElement("span", null, "Hoàn tất"),
    children: createElement("p", null, "Nội dung"),
  }));
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain("safe-area-inset-top");
  expect(html).toContain("sm:max-h-[900px]");
  expect(html).toContain("sm:max-w-[1600px]");
  expect(html).toContain("safe-area-inset-bottom");
});

test("modal is not rendered while closed", () => {
  expect(renderToStaticMarkup(createElement(RowPreviewModal, {
    title: "Chi tiết", open: false, onClose() {}, children: "hidden",
  }))).toBe("");
});

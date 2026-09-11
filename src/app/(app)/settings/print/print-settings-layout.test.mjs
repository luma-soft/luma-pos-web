import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const form = readFileSync(
  new URL("./print-settings-form.tsx", import.meta.url),
  "utf8",
);

test("template selection is combined with the invoice settings panel", () => {
  expect(form).toContain('import { Select } from "@/components/ui/select"');
  expect(form).toContain('aria-label={t("printSettings.templateList")}');
  expect(form).toContain("options={visible.map((item) => ({");
  expect(form).toContain("onValueChange={(value) => { setSelectedId(value); setMsg(null); }}");
  expect(form).not.toContain('<aside className="rounded-card border border-border bg-surface">');
  expect(form).not.toContain("xl:grid-cols-[320px_minmax(0,1fr)]");
});

test("the combined panel keeps template creation and status context", () => {
  expect(form).toContain("onClick={addTemplate}");
  expect(form).toContain("item.isDefault ? \"★ · \" : \"\"");
  expect(form).toContain('item.isActive ? t("printSettings.active") : t("printSettings.inactive")');
});

test("settings and preview use a vertical layout with a fullscreen preview action", () => {
  expect(form).not.toContain("xl:grid-cols-[minmax(0,1fr)_380px]");
  expect(form).toContain('className="space-y-6"');
  expect(form).toContain("isPreviewFullscreen && \"fixed inset-0");
  expect(form).toContain("previewSurfaceRef.current?.scrollTo({ top: 0, left: 0 })");
  expect(form).toContain('"printSettings.fullscreenPreview"');
  expect(form).toContain('"printSettings.exitFullscreenPreview"');
});

test("template picker keeps its own row and the add button at control height", () => {
  expect(form).toContain('sm:grid-cols-[minmax(0,1fr)_auto]');
  expect(form).toContain('rootClassName="w-full min-w-0"');
  expect(form).toContain("shrink-0 self-end items-center justify-center");
});

test("tax visibility exposes a custom document label", () => {
  expect(form).toContain('t("printSettings.taxLabel")');
  expect(form).toContain('patchTextOption("taxLabel", event.target.value)');
  expect(form).toContain('selected.options.showTax');
});

test("each template action shows loading on the button that triggered it", () => {
  for (const action of ["save", "duplicate", "setDefault", "deactivate"]) {
    expect(form).toContain(`pendingAction === "${action}"`);
  }
  expect(form).not.toContain("{isPending ? <Loader2");
});

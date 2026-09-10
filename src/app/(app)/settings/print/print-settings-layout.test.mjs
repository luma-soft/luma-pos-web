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

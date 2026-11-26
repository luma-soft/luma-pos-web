import { readSource } from "../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const src = readSource("./pos-client.tsx", import.meta.url);
test("POS mobile editable text fields avoid iPhone Safari zoom", () => {
  expect(src).toContain("min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base");
  expect(src).toContain("min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-base lg:text-sm");
  expect(src).toContain("setOrderNote(e.target.value)");
  expect(src).toContain("setProjectName(e.target.value)");
  // Phones edit the line note on the full-screen line editor (17pt field, no zoom).
  expect(src).toContain("screen.onNoteChange(event.target.value)");
  expect(src).toContain("px-3.5 py-3 text-[17px] outline-none");
  expect(src).toContain("setLineNote(l.key, e.target.value)");
});

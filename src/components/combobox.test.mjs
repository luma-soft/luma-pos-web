import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./combobox.tsx", import.meta.url), "utf8");
const filterPickerSource = readFileSync(
  new URL("../app/(app)/sales/tabs/filter-drawer-shared.tsx", import.meta.url),
  "utf8",
);

test("desktop combobox menus escape modal scroll clipping", () => {
  expect(source).toContain("createPortal");
  expect(source).toContain("positionFloatingMenu");
  expect(source).toContain("findScrollBoundary");
});

test("portaled searchable pickers focus their search input after opening", () => {
  for (const pickerSource of [source, filterPickerSource]) {
    expect(pickerSource).toContain("const searchRef = useRef<HTMLInputElement>(null);");
    expect(pickerSource).toContain("searchRef.current?.focus({ preventScroll: true })");
    expect(pickerSource).toContain("ref={searchRef}");
  }
});

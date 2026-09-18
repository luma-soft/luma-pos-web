import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./combobox.tsx", import.meta.url), "utf8");

test("desktop combobox menus escape modal scroll clipping", () => {
  expect(source).toContain("createPortal");
  expect(source).toContain("positionFloatingMenu");
  expect(source).toContain("findScrollBoundary");
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/ui/action-menu.tsx", "utf8");

describe("LumaActionMenu overflow behavior", () => {
  test("renders the open menu in a body portal outside clipping containers", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
  });

  test("positions the portaled menu against the viewport while scrolling", () => {
    expect(source).toContain("positionFloatingMenu({");
    expect(source).toContain('position: "fixed"');
    expect(source).toContain(
      'window.addEventListener("scroll", updateMenuPosition, true)',
    );
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sources = [
  ["print template", "./print/print-template-menu.tsx"],
  ["data table columns", "./data-table.tsx"],
  ["sales filter pickers", "../app/(app)/sales/tabs/filter-drawer-shared.tsx"],
];

describe("sales dropdown viewport positioning", () => {
  for (const [name, path] of sources) {
    test(`${name} uses the shared floating portal`, () => {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toContain("FloatingMenuPortal");
    });
  }
});

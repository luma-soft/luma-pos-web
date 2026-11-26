import { readSource } from "../test-support/read-source.mjs";
import { describe, expect, test } from "bun:test";

const sources = [
  ["print template", "./print/print-template-menu.tsx"],
  ["data table columns", "./data-table.tsx"],
  ["sales filter pickers", "../app/(app)/sales/tabs/filter-drawer-shared.tsx"],
];

describe("sales dropdown viewport positioning", () => {
  for (const [name, path] of sources) {
    test(`${name} uses the shared floating portal`, () => {
      const source = readSource(path, import.meta.url);
      expect(source).toContain("FloatingMenuPortal");
    });
  }
});

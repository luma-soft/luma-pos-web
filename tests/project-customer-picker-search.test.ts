import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const source = readFileSync(
  "src/app/(app)/projects/project-widgets.tsx",
  "utf8",
);

describe("project customer picker", () => {
  test("keeps customer search enabled in both create and edit dialogs", () => {
    expect(source.match(/\bsearchable\b/g)).toHaveLength(2);
    expect(source.match(/searchPlaceholder=\{t\("common\.search"\)\}/g)).toHaveLength(2);
  });
});

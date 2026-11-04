import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./attribute-catalog-dialog.tsx", import.meta.url), "utf8");

test("creating an attribute closes its modal before refreshing the catalog", () => {
  const createBranch = source.slice(
    source.indexOf('if (view.kind === "create")'),
    source.indexOf("} else {", source.indexOf('if (view.kind === "create")')),
  );

  expect(createBranch.indexOf("onClose();")).toBeGreaterThan(-1);
  expect(createBranch.indexOf("onClose();")).toBeLessThan(createBranch.indexOf("onChanged();"));
});

import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";

const source = readSource("./attribute-catalog-dialog.tsx", import.meta.url);

test("creating an attribute closes its modal before refreshing the catalog", () => {
  const createBranch = source.slice(
    source.indexOf('if (view.kind === "create")'),
    source.indexOf("} else {", source.indexOf('if (view.kind === "create")')),
  );

  expect(createBranch.indexOf("onClose();")).toBeGreaterThan(-1);
  expect(createBranch.indexOf("onClose();")).toBeLessThan(createBranch.indexOf("onChanged();"));
});

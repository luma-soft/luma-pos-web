import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./library-upload-dialog.tsx", import.meta.url), "utf8");

test("a completed upload closes before the library refresh finishes", () => {
  const successStart = source.indexOf("if (!failed.length)");
  const partialStart = source.indexOf("} else {", successStart);
  const successBranch = source.slice(successStart, partialStart);

  expect(successBranch.indexOf("onClose();")).toBeGreaterThan(-1);
  expect(successBranch.indexOf("onClose();")).toBeLessThan(successBranch.indexOf("onUploaded("));
  expect(successBranch).not.toContain("await onUploaded(");
});

test("a partial upload keeps the modal open so failed files can be retried", () => {
  const partialStart = source.indexOf("} else {", source.indexOf("if (!failed.length)"));
  const finallyStart = source.indexOf("} finally {", partialStart);
  const partialBranch = source.slice(partialStart, finallyStart);

  expect(partialBranch).toContain('setError(t("partialUpload"');
  expect(partialBranch).not.toContain("onClose();");
});

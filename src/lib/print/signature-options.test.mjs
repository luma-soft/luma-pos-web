import { expect, test } from "bun:test";
import { defaultOptionsForDocType, normalizeSignatureOptions, updateSignatureOption } from "./template-shared";

test("legacy signature settings restore all three positions", () => {
  const options = {
    ...defaultOptionsForDocType("order"),
    showSignatures: true,
    showSignatureLeft: false,
    showSignatureMiddle: false,
    showSignatureRight: false,
  };

  expect(normalizeSignatureOptions(options)).toMatchObject({
    showSignatures: true,
    showSignatureLeft: true,
    showSignatureMiddle: true,
    showSignatureRight: true,
  });
});

test("enabling the signature area restores all positions when none is selected", () => {
  const options = {
    ...defaultOptionsForDocType("order"),
    showSignatures: false,
    showSignatureLeft: false,
    showSignatureMiddle: false,
    showSignatureRight: false,
  };

  expect(updateSignatureOption(options, "showSignatures", true)).toMatchObject({
    showSignatures: true,
    showSignatureLeft: true,
    showSignatureMiddle: true,
    showSignatureRight: true,
  });
});

test("turning off the final signature position also disables the signature area", () => {
  const options = {
    ...defaultOptionsForDocType("order"),
    showSignatures: true,
    showSignatureLeft: true,
    showSignatureMiddle: false,
    showSignatureRight: false,
  };

  expect(updateSignatureOption(options, "showSignatureLeft", false)).toMatchObject({
    showSignatures: false,
    showSignatureLeft: false,
    showSignatureMiddle: false,
    showSignatureRight: false,
  });
});

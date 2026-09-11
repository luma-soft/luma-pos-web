import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("A4 and A5 print pages reserve a margin on every physical page", () => {
  expect(css).toContain("@page print-a4 { size: A4 portrait; margin: 12mm; }");
  expect(css).toContain("@page print-a5 { size: A5 portrait; margin: 10mm; }");
  expect(css).toContain(`.print-document-root .print-document--a4 {
    width: 186mm !important;
    padding: 0 !important;
  }`);
  expect(css).toContain(`.print-document-root .print-document--a5 {
    width: 128mm !important;
    padding: 0 !important;
  }`);
  expect(css).toContain(`body.pos-printing .print-document--a4 {
    width: 186mm !important;
    padding: 0 !important;
  }`);
  expect(css).toContain(`body.pos-printing .print-document--a5 {
    width: 128mm !important;
    padding: 0 !important;
  }`);
});

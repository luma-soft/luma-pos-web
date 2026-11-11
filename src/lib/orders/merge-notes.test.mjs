import assert from "node:assert/strict";
import test from "node:test";
import { separateMergeNotes } from "./merge-notes.ts";

test("legacy merged invoice prints no auto-generated merge note", () => {
  assert.deepEqual(
    separateMergeNotes("Gộp từ: DH-02, DH-01", { mergedFromCodes: ["DH-01", "DH-02"] }),
    { userNote: null, systemNote: "Gộp từ: DH-01, DH-02" },
  );
});

test("new merged invoice keeps system history without persisting it in user note", () => {
  assert.deepEqual(
    separateMergeNotes(null, { mergedFromCodes: ["DH-01", "DH-02"] }),
    { userNote: null, systemNote: "Gộp từ: DH-01, DH-02" },
  );
});

test("a manually entered note is not mistaken for a merge marker", () => {
  assert.deepEqual(
    separateMergeNotes("Giao hàng trước 16h", { mergedFromCodes: ["DH-01", "DH-02"] }),
    { userNote: "Giao hàng trước 16h", systemNote: "Gộp từ: DH-01, DH-02" },
  );
});

test("legacy source invoice retains operator-entered text", () => {
  assert.deepEqual(
    separateMergeNotes("Khách nhận tại quầy · Đã gộp vào DHG-01", { mergedIntoCode: "DHG-01" }),
    { userNote: "Khách nhận tại quầy", systemNote: "Đã gộp vào DHG-01" },
  );
});

test("unrelated invoices preserve notes that happen to mention merging", () => {
  assert.deepEqual(
    separateMergeNotes("Gộp từ: đơn ngoài hệ thống"),
    { userNote: "Gộp từ: đơn ngoài hệ thống", systemNote: null },
  );
});

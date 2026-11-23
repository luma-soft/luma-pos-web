import { expect, test } from "bun:test";
import { buildVietQrImageUrl, buildVietQrPayload, sanitizeVietQrReference } from "./vietqr";

function crc16(input) {
  let crc = 0xffff;
  for (const ch of input) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

test("builds a dynamic NAPAS VietQR payload with bank BIN, amount and content", () => {
  const payload = buildVietQrPayload({ bankCode: "VCB", accountNumber: "0123 456 789", amount: 125000.4, reference: "LP2611231200AB12" });
  expect(payload).toStartWith("000201010212");
  expect(payload).toContain("38540010A00000072701240006970436011001234567890208QRIBFTTA");
  expect(payload).toContain("5303704540612500058" + "02VN");
  expect(payload).toContain("62200816LP2611231200AB12");
  const body = payload.slice(0, -4);
  expect(body.endsWith("6304")).toBe(true);
  expect(payload.slice(-4)).toBe(crc16(body));
});

test("builds a static payload without amount and accepts a raw BIN", () => {
  const payload = buildVietQrPayload({ bankCode: "970422", accountNumber: "999" });
  expect(payload).toStartWith("000201010211");
  expect(payload).toContain("53037045802VN");
  expect(payload).toContain("0006970422");
});

test("rejects unknown banks and invalid accounts", () => {
  expect(buildVietQrPayload({ bankCode: "ZZZ", accountNumber: "0123" })).toBeNull();
  expect(buildVietQrPayload({ bankCode: "VCB", accountNumber: "" })).toBeNull();
  expect(buildVietQrPayload({ bankCode: "VCB", accountNumber: "12#4" })).toBeNull();
});

test("strips Vietnamese diacritics from transfer content", () => {
  expect(sanitizeVietQrReference("Thanh toán đơn #HD001")).toBe("Thanh toan don HD001");
});

test("image URL points at the Luma VietQR route", () => {
  expect(buildVietQrImageUrl({ bankCode: "VCB", accountNumber: "0123456789", amount: 2000, reference: "HD001" }))
    .toBe("/api/payments/vietqr?bank=VCB&acc=0123456789&amount=2000&des=HD001");
  expect(buildVietQrImageUrl({ bankCode: "VCB", accountNumber: "1" }, "https://pos.example.com/"))
    .toBe("https://pos.example.com/api/payments/vietqr?bank=VCB&acc=1");
});

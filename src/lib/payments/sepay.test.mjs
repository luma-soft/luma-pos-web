import { createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import {
  extractSepayApiKey,
  generateSepayPaymentReference,
  normalizeSepayWebhookPayload,
  verifySepaySignature,
} from "./sepay";

const officialPayload = {
  id: 92704,
  gateway: "Vietcombank",
  transactionDate: "2024-07-02 11:08:33",
  accountNumber: "1017588888",
  subAccount: "",
  code: "LUMA260914123456ABCD",
  content: "LUMA260914123456ABCD chuyen tien",
  transferType: "in",
  transferAmount: 5000000,
  referenceCode: "FT24012345678",
};

test("normalizes the SePay payment code instead of the bank reference", () => {
  expect(normalizeSepayWebhookPayload(officialPayload)?.referenceCode).toBe(
    "LUMA260914123456ABCD",
  );
});

test("falls back to the Luma reference in transfer content when SePay code is null", () => {
  expect(normalizeSepayWebhookPayload({
    ...officialPayload,
    code: null,
    content: "Thanh toan LUMA-260914-123456-ABCD",
  })?.referenceCode).toBe("LUMA-260914-123456-ABCD");
});

test("extracts the official SePay Apikey authorization scheme", () => {
  expect(extractSepayApiKey("Apikey sepay-secret")).toBe("sepay-secret");
  expect(extractSepayApiKey("Bearer legacy-secret")).toBe("legacy-secret");
  expect(extractSepayApiKey("Basic ignored")).toBeNull();
});

test("verifies current HMAC signatures and rejects stale timestamps", () => {
  const rawBody = JSON.stringify(officialPayload);
  const secret = "test-webhook-secret";
  const nowMs = Date.parse("2026-09-14T12:00:00Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  const staleTimestamp = String(Number(timestamp) - 301);
  const staleSignature = `sha256=${createHmac("sha256", secret)
    .update(`${staleTimestamp}.${rawBody}`)
    .digest("hex")}`;

  expect(verifySepaySignature(rawBody, signature, secret, timestamp, nowMs)).toBe(true);
  expect(verifySepaySignature(
    rawBody,
    staleSignature,
    secret,
    staleTimestamp,
    nowMs,
  )).toBe(false);
});

test("generates a SePay-filterable LUMA reference", () => {
  expect(generateSepayPaymentReference(
    new Date("2026-09-14T12:34:56Z"),
    "A1B2",
  )).toBe("LUMA260914123456A1B2");
});

import { expect, test } from "bun:test";

import { readR2Config } from "../src/lib/media/config";
import { createObjectKey } from "../src/lib/media/object-key";

test("creates an immutable tenant key without exposing the original filename", () => {
  const key = createObjectKey({
    storeId: "11111111-1111-4111-8111-111111111111",
    domain: "projects",
    mediaId: "22222222-2222-4222-8222-222222222222",
    fileName: "Biên bản Chị Hậu / 0909 123 456.pdf",
    now: new Date("2026-08-30T00:00:00Z"),
  });

  expect(key).toBe(
    "stores/11111111-1111-4111-8111-111111111111/projects/2026/08/22222222-2222-4222-8222-222222222222/original.pdf",
  );
  expect(key).not.toContain("Chi-Hau");
  expect(key).not.toContain("0909");
});

test("rejects unvalidated file extensions from object keys", () => {
  expect(() =>
    createObjectKey({
      storeId: "11111111-1111-4111-8111-111111111111",
      domain: "projects",
      mediaId: "22222222-2222-4222-8222-222222222222",
      fileName: "invoice.pdf.exe",
      now: new Date("2026-08-30T00:00:00Z"),
    }),
  ).toThrow("Unsupported media file extension");
});

test("rejects incomplete R2 credentials", () => {
  expect(() => readR2Config({ R2_ACCOUNT_ID: "account" })).toThrow(
    "R2 configuration is incomplete",
  );
});

test("reads a complete R2 configuration with separate public and private buckets", () => {
  expect(
    readR2Config({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      R2_PUBLIC_BUCKET: "public-media",
      R2_PRIVATE_BUCKET: "private-media",
      R2_PUBLIC_BASE_URL: "https://media.lumapos.vn/",
    }),
  ).toEqual({
    accountId: "account",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    publicBucket: "public-media",
    privateBucket: "private-media",
    publicBaseUrl: "https://media.lumapos.vn",
  });
});

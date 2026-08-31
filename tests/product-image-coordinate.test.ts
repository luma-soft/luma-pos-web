import { describe, expect, test } from "bun:test";

import {
  parseProductImagePublicUrl,
} from "../src/lib/images/product-image-coordinate";
import { readPublicMediaConfig } from "../src/lib/media/config";

const STORE_ID = "10000000-0000-4000-8000-000000000001";
const MEDIA_ID = "50000000-0000-4000-8000-000000000001";
const PATH =
  `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.jpg`;
const PUBLIC_MEDIA = {
  publicBaseUrl: "https://media.staging.lumapos.test",
  publicBucket: "staging-public-media",
};

describe("product public-media coordinates", () => {
  test("round-trips a configured non-production origin", () => {
    expect(parseProductImagePublicUrl(
      `${PUBLIC_MEDIA.publicBaseUrl}/${PATH}`,
      PUBLIC_MEDIA,
    )).toEqual({ storeId: STORE_ID, mediaId: MEDIA_ID, path: PATH });
  });

  test("canonicalizes UUID path coordinates while preserving the exact object key", () => {
    const upperStoreId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const upperMediaId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
    const upperPath =
      `stores/${upperStoreId}/products/2026/08/${upperMediaId}/original.jpg`;

    expect(parseProductImagePublicUrl(
      `${PUBLIC_MEDIA.publicBaseUrl}/${upperPath}`,
      PUBLIC_MEDIA,
    )).toEqual({
      storeId: upperStoreId.toLowerCase(),
      mediaId: upperMediaId.toLowerCase(),
      path: upperPath,
    });
  });

  test("rejects malformed and alternate first-party coordinates", () => {
    for (const value of [
      `http://media.staging.lumapos.test/${PATH}`,
      `https://media.staging.lumapos.test./${PATH}`,
      `https://media.staging.lumapos.test/${PATH}?token=secret`,
      `https://media.staging.lumapos.test/${PATH}#fragment`,
      `https://other-media.test/${PATH}`,
      `${PUBLIC_MEDIA.publicBaseUrl}/${PATH.replace("original.jpg", "original.jpeg")}`,
    ]) {
      expect(parseProductImagePublicUrl(value, PUBLIC_MEDIA), value).toBeNull();
    }
  });

  test("reads public URL and bucket policy without private R2 credentials", () => {
    expect(readPublicMediaConfig({
      R2_PUBLIC_BASE_URL: `${PUBLIC_MEDIA.publicBaseUrl}/`,
      R2_PUBLIC_BUCKET: PUBLIC_MEDIA.publicBucket,
    })).toEqual(PUBLIC_MEDIA);
  });

  test("rejects a trailing-dot public host before it becomes policy", () => {
    expect(() => readPublicMediaConfig({
      R2_PUBLIC_BASE_URL: "https://media.staging.lumapos.test.",
      R2_PUBLIC_BUCKET: PUBLIC_MEDIA.publicBucket,
    })).toThrow("R2 public base URL is invalid");
  });

  test("fails closed when a pure caller injects an unvalidated origin policy", () => {
    const trailingDotBase = "https://media.staging.lumapos.test.";
    expect(parseProductImagePublicUrl(
      `${trailingDotBase}/${PATH}`,
      { publicBaseUrl: trailingDotBase },
    )).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";

import { checkManagedMediaReadiness } from "../src/lib/media/readiness";

const READY_ENV = {
  MEDIA_WRITE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_PUBLIC_BUCKET: "lumapos-public",
  R2_PRIVATE_BUCKET: "lumapos-private",
  R2_PUBLIC_BASE_URL: "https://media.lumapos.vn",
};

describe("managed media production readiness", () => {
  test("requires R2 writes and probes both configured buckets", async () => {
    const buckets: string[] = [];
    const report = await checkManagedMediaReadiness(READY_ENV, {
      headBucket: async (bucket) => {
        buckets.push(bucket);
      },
    });

    expect(buckets.sort()).toEqual(["lumapos-private", "lumapos-public"]);
    expect(report).toEqual({
      ready: true,
      requiredCapabilities: ["managed-media-r2-v1"],
      publicBucketReachable: true,
      privateBucketReachable: true,
      publicBaseUrlHttps: true,
    });
  });

  test("fails closed before probing when the write provider is not R2", async () => {
    let probes = 0;
    await expect(
      checkManagedMediaReadiness(
        {
          ...READY_ENV,
          MEDIA_WRITE_PROVIDER: "supabase",
        },
        {
          headBucket: async () => {
            probes += 1;
          },
        },
      ),
    ).rejects.toThrow("managed_media_write_provider_not_r2");
    expect(probes).toBe(0);
  });

  test("fails when either bucket cannot be reached", async () => {
    await expect(
      checkManagedMediaReadiness(READY_ENV, {
        headBucket: async (bucket) => {
          if (bucket === "lumapos-private") throw new Error("forbidden");
        },
      }),
    ).rejects.toThrow("managed_media_bucket_unreachable");
  });
});

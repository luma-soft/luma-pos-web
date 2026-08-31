import { afterEach, describe, expect, test } from "bun:test";

import {
  drainMediaCleanup,
  type MediaCleanupCandidate,
  type MediaCleanupRepository,
} from "../src/lib/media/cleanup";
import {
  handleMediaCleanupRequest,
  isMediaCleanupCronAuthorized,
} from "../src/app/api/cron/media/cleanup/route";
import vercelConfig from "../vercel.json";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

function candidate(
  overrides: Partial<MediaCleanupCandidate> = {},
): MediaCleanupCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "r2",
    bucket: "luma-private",
    objectKey: "stores/store/projects/media/original",
    thumbnailObjectKey: null,
    sizeBytes: 120,
    thumbnailSizeBytes: null,
    reason: "pending-expired",
    ...overrides,
  };
}

function fakeRepository(items: MediaCleanupCandidate[]) {
  const completed: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const claims: Array<Record<string, unknown>> = [];
  const repository: MediaCleanupRepository = {
    async claim(input) {
      claims.push(input);
      return items.slice(0, input.batchSize);
    },
    async complete(input) {
      completed.push(input.id);
      return true;
    },
    async fail(input) {
      failed.push({ id: input.id, error: input.error });
      return true;
    },
  };
  return { repository, completed, failed, claims };
}

describe("bounded R2 media cleanup", () => {
  test("cleanup removes abandoned pending media after 24 hours", async () => {
    const repo = fakeRepository([candidate()]);
    const removed: Array<{ bucket: string; key: string }> = [];

    const result = await drainMediaCleanup({
      now: NOW,
      batchSize: 50,
      repository: repo.repository,
      storage: {
        remove: async (input) => { removed.push(input); },
      },
      createLeaseToken: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result).toEqual({
      claimed: 1,
      pendingExpired: 1,
      softDeleted: 0,
      cleaned: 1,
      missingObjects: 0,
      failed: 0,
      bytesReclaimed: 120,
    });
    expect(removed).toEqual([{
      bucket: "luma-private",
      key: "stores/store/projects/media/original",
    }]);
    expect(repo.completed).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(repo.claims[0]).toMatchObject({
      batchSize: 50,
      now: NOW,
      pendingExpiredBefore: new Date("2026-08-30T12:00:00.000Z"),
      staleLeaseBefore: new Date("2026-08-31T11:45:00.000Z"),
    });
  });

  test("already missing object completes deletion without retry", async () => {
    const repo = fakeRepository([candidate()]);
    const missing = Object.assign(new Error("not found"), { name: "NoSuchKey" });

    const result = await drainMediaCleanup({
      now: NOW,
      repository: repo.repository,
      storage: { remove: async () => { throw missing; } },
      createLeaseToken: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(result.failed).toBe(0);
    expect(result.missingObjects).toBe(1);
    expect(repo.completed).toHaveLength(1);
    expect(repo.failed).toHaveLength(0);
  });

  test("removes original and thumbnail once, then records retry metadata on failure", async () => {
    const repo = fakeRepository([candidate({
      reason: "soft-deleted",
      thumbnailObjectKey: "stores/store/projects/media/thumbnail",
      thumbnailSizeBytes: 30,
    })]);
    const removed: string[] = [];

    const result = await drainMediaCleanup({
      now: NOW,
      repository: repo.repository,
      storage: {
        remove: async ({ key }) => {
          removed.push(key);
          if (key.endsWith("thumbnail")) throw new Error("R2 unavailable");
        },
      },
      createLeaseToken: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(removed).toEqual([
      "stores/store/projects/media/original",
      "stores/store/projects/media/thumbnail",
    ]);
    expect(result).toMatchObject({ softDeleted: 1, cleaned: 0, failed: 1 });
    expect(repo.completed).toHaveLength(0);
    expect(repo.failed).toEqual([{
      id: "11111111-1111-4111-8111-111111111111",
      error: "R2 unavailable",
    }]);
  });

  test("deduplicates identical original and thumbnail keys", async () => {
    const repo = fakeRepository([candidate({
      thumbnailObjectKey: "stores/store/projects/media/original",
      thumbnailSizeBytes: 120,
    })]);
    const removed: string[] = [];

    await drainMediaCleanup({
      now: NOW,
      repository: repo.repository,
      storage: { remove: async ({ key }) => { removed.push(key); } },
      createLeaseToken: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(removed).toEqual(["stores/store/projects/media/original"]);
  });

  test("rejects unbounded batch sizes before claiming", async () => {
    const repo = fakeRepository([]);
    await expect(drainMediaCleanup({
      now: NOW,
      batchSize: 51,
      repository: repo.repository,
      storage: { remove: async () => {} },
    })).rejects.toThrow("invalid_media_cleanup_batch_size");
    expect(repo.claims).toHaveLength(0);
  });
});

describe("media cleanup cron", () => {
  test("runs hourly at minute 15", () => {
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/cron/media/cleanup",
      schedule: "15 * * * *",
    });
  });

  test("uses constant-time bearer authorization and rejects missing configuration", () => {
    process.env.CRON_SECRET = "media-cron-secret";
    expect(isMediaCleanupCronAuthorized(new Request("https://luma.test", {
      headers: { authorization: "Bearer media-cron-secret" },
    }))).toBe(true);
    for (const value of [null, "Bearer", "Bearer wrong", "Bearer media-cron-secret-extra"]) {
      const headers = value ? { authorization: value } : undefined;
      expect(isMediaCleanupCronAuthorized(new Request("https://luma.test", { headers })))
        .toBe(false);
    }
    delete process.env.CRON_SECRET;
    expect(isMediaCleanupCronAuthorized(new Request("https://luma.test", {
      headers: { authorization: "Bearer anything" },
    }))).toBe(false);
  });

  test("unauthorized request never starts cleanup", async () => {
    process.env.CRON_SECRET = "media-cron-secret";
    let called = false;
    const response = await handleMediaCleanupRequest(new Request("https://luma.test", {
      headers: { authorization: "Bearer wrong" },
    }), {
      drain: async () => {
        called = true;
        throw new Error("must not run");
      },
    });
    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  test("returns aggregate metrics without object coordinates or tenant data", async () => {
    process.env.CRON_SECRET = "media-cron-secret";
    const response = await handleMediaCleanupRequest(new Request("https://luma.test", {
      headers: { authorization: "Bearer media-cron-secret" },
    }), {
      drain: async () => ({
        claimed: 2,
        pendingExpired: 1,
        softDeleted: 1,
        cleaned: 2,
        missingObjects: 0,
        failed: 0,
        bytesReclaimed: 200,
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/objectKey|filename|storeId|signedUrl|luma-private/i);
    expect(body).toMatchObject({
      ok: true,
      data: { cleaned: 2, bytesReclaimed: 200 },
    });
  });
});

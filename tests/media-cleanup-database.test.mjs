import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const { mediaObjects, productMedia } = schema;
const { createDatabaseMediaCleanupRepository } = await import(
  `${projectRoot}/src/lib/media/cleanup.ts`
);

const client = new PGlite();
const database = drizzle(client, { schema });
const repository = createDatabaseMediaCleanupRepository(database);

const NOW = new Date("2026-08-31T12:00:00.000Z");
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const EXPIRED_ID = "30000000-0000-4000-8000-000000000001";
const STALE_ID = "30000000-0000-4000-8000-000000000002";
const FRESH_ID = "30000000-0000-4000-8000-000000000003";
const REFERENCED_ID = "30000000-0000-4000-8000-000000000004";
const SUPABASE_ID = "30000000-0000-4000-8000-000000000005";
const CLAIM_TOKEN = "40000000-0000-4000-8000-000000000001";
const STALE_TOKEN = "40000000-0000-4000-8000-000000000002";

async function applySqlFile(path) {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) await client.exec(statement);
  }
}

function mediaValue(id, overrides = {}) {
  return {
    id,
    storeId: STORE_ID,
    provider: "r2",
    visibility: "private",
    purpose: "project-document",
    targetId: STORE_ID,
    domain: "projects",
    bucket: "private-media",
    objectKey: `stores/${STORE_ID}/projects/${id}/original.jpg`,
    originalFileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 120,
    status: "pending",
    uploadExpiresAt: new Date("2026-08-30T11:59:00.000Z"),
    ...overrides,
  };
}

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${file}`);
  }
  await client.exec(`
    insert into stores (id, slug) values ('${STORE_ID}', 'media-cleanup-store');
    insert into products (id, store_id, sku, name)
    values ('${PRODUCT_ID}', '${STORE_ID}', 'CLEANUP-1', 'Cleanup product');
  `);
});

afterAll(async () => client.close());

beforeEach(async () => {
  await database.delete(productMedia);
  await database.delete(mediaObjects);
  await database.insert(mediaObjects).values([
    mediaValue(EXPIRED_ID),
    mediaValue(STALE_ID, {
      status: "deleted",
      deletedAt: new Date("2026-08-29T12:00:00.000Z"),
      cleanupClaimToken: STALE_TOKEN,
      cleanupClaimedAt: new Date("2026-08-31T11:44:00.000Z"),
      cleanupAttempts: 2,
    }),
    mediaValue(FRESH_ID, {
      uploadExpiresAt: new Date("2026-08-30T13:00:00.000Z"),
    }),
    mediaValue(REFERENCED_ID, {
      status: "ready",
      readyAt: new Date("2026-08-30T12:00:00.000Z"),
      verifiedAt: new Date("2026-08-30T12:00:00.000Z"),
    }),
    mediaValue(SUPABASE_ID, {
      provider: "supabase",
      status: "deleted",
      deletedAt: new Date("2026-08-29T12:00:00.000Z"),
    }),
  ]);
  await database.insert(productMedia).values({
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    mediaObjectId: REFERENCED_ID,
  });
  // Simulate a legacy/direct tombstone so cleanup must still enforce references.
  await database.update(mediaObjects).set({
    status: "deleted",
    deletedAt: new Date("2026-08-29T12:00:00.000Z"),
  }).where(eq(mediaObjects.id, REFERENCED_ID));
});

describe("database media cleanup leases", () => {
  test("recovers stale leases, excludes referenced/provider rows, and fences acknowledgements", async () => {
    const claimed = await repository.claim({
      now: NOW,
      batchSize: 50,
      leaseToken: CLAIM_TOKEN,
      pendingExpiredBefore: new Date("2026-08-30T12:00:00.000Z"),
      staleLeaseBefore: new Date("2026-08-31T11:45:00.000Z"),
    });
    expect(claimed.map((item) => item.id).sort()).toEqual([
      EXPIRED_ID,
      STALE_ID,
    ]);
    expect(claimed.map((item) => item.reason).sort()).toEqual([
      "pending-expired",
      "soft-deleted",
    ]);

    expect(await repository.complete({
      id: EXPIRED_ID,
      leaseToken: STALE_TOKEN,
      completedAt: NOW,
    })).toBe(false);
    expect(await repository.complete({
      id: EXPIRED_ID,
      leaseToken: CLAIM_TOKEN,
      completedAt: NOW,
    })).toBe(true);
    expect(await repository.fail({
      id: STALE_ID,
      leaseToken: CLAIM_TOKEN,
      failedAt: NOW,
      error: "temporary R2 failure",
    })).toBe(true);

    const rows = await database.select().from(mediaObjects);
    const expired = rows.find((row) => row.id === EXPIRED_ID);
    const stale = rows.find((row) => row.id === STALE_ID);
    const referenced = rows.find((row) => row.id === REFERENCED_ID);
    expect(expired).toMatchObject({
      status: "deleted",
      cleanupAttempts: 1,
      cleanupClaimToken: null,
      storageDeletedAt: NOW,
    });
    expect(stale).toMatchObject({
      cleanupAttempts: 3,
      cleanupClaimToken: null,
      cleanupLastError: "temporary R2 failure",
      storageDeletedAt: null,
    });
    expect(referenced).toMatchObject({
      cleanupAttempts: 0,
      storageDeletedAt: null,
    });
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import type { ObjectStorage } from "../src/lib/media/types";
import {
  classifyLegacyUrl,
  createMediaMigrationEngine,
  type MediaMigrationItem,
  type MediaMigrationRepository,
  type MediaMigrationStatus,
} from "../src/lib/media/migration";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_KEY = `stores/${STORE_ID}/products/camera.png`;
const SOURCE_URL = `https://project.supabase.co/storage/v1/object/public/products/${SOURCE_KEY}`;

describe("legacy media classification", () => {
  test("classifies only allowlisted Luma-owned Supabase URLs", () => {
    expect(classifyLegacyUrl(SOURCE_URL, {
      allowedHosts: new Set(["project.supabase.co"]),
      allowedBuckets: new Set(["products", "ai-attachments"]),
    })).toEqual({
      provider: "supabase",
      bucket: "products",
      key: SOURCE_KEY,
    });
    expect(classifyLegacyUrl("https://vendor.example/camera.jpg", {
      allowedHosts: new Set(["project.supabase.co"]),
      allowedBuckets: new Set(["products"]),
    })).toBeNull();
    expect(classifyLegacyUrl(
      "https://project.supabase.co/storage/v1/object/public/products/%2e%2e/private.png",
      {
        allowedHosts: new Set(["project.supabase.co"]),
        allowedBuckets: new Set(["products"]),
      },
    )).toBeNull();
  });
});

describe("resumable media migration engine", () => {
  test("copy rerun reuses the same migration item and immutable R2 key", async () => {
    const repository = new MemoryMigrationRepository();
    const source = new MemoryStorage({
      "products/source.png": Uint8Array.from([1, 2, 3, 4]),
    });
    const target = new MemoryStorage();
    const engine = createMediaMigrationEngine({
      repository,
      sourceStorage: source,
      targetStorage: target,
      targetBucket: "lumapos-test-private-media",
      idFactory: () => ITEM_ID,
      now: () => new Date("2026-08-31T00:00:00.000Z"),
    });
    const inventory = {
      runId: RUN_ID,
      storeId: STORE_ID,
      sourceProvider: "supabase" as const,
      sourceBucket: "products",
      sourceKey: "source.png",
      purpose: "product-image" as const,
      targetId: STORE_ID,
      domain: "products",
      visibility: "public" as const,
      originalFileName: "camera.png",
      mimeType: "image/png",
      references: [{ kind: "product-image", recordId: PRODUCT_ID, index: 0 }],
    };

    const first = await engine.inventory(inventory);
    const second = await engine.inventory(inventory);
    const copied = await engine.copy(first.id);
    const copiedAgain = await engine.copy(second.id);

    expect(first.id).toBe(second.id);
    expect(copied.targetKey).toBe(copiedAgain.targetKey);
    expect(copied.targetKey).toBe(
      `stores/${STORE_ID}/products/migration/${ITEM_ID}/original`,
    );
    expect(copied.targetKey).not.toContain("camera.png");
    expect(target.puts).toHaveLength(1);
    expect(repository.items).toHaveLength(1);
    expect(copied.status).toBe("copied");
    expect(copied.sourceSha256).toBe(copied.targetSha256);
  });

  test("verify quarantines a target whose bytes do not match the copied hash", async () => {
    const fixture = await copiedFixture();
    fixture.target.objects.set(
      `${fixture.copied.targetBucket}/${fixture.copied.targetKey}`,
      Uint8Array.from([9, 9, 9, 9]),
    );

    const result = await fixture.engine.verify(fixture.copied.id);

    expect(result.status).toBe("quarantined");
    expect(result.lastError).toBe("target_hash_mismatch");
    expect(fixture.repository.cutovers).toHaveLength(0);
  });

  test("cutover is atomic, idempotent, and rollback restores legacy resolution", async () => {
    const fixture = await copiedFixture();
    const verified = await fixture.engine.verify(fixture.copied.id);

    const cutover = await fixture.engine.cutover(verified.id);
    const cutoverAgain = await fixture.engine.cutover(verified.id);
    const rolledBack = await fixture.engine.rollback(verified.id);

    expect(cutover.status).toBe("cutover");
    expect(cutoverAgain.status).toBe("cutover");
    expect(fixture.repository.cutovers).toHaveLength(1);
    expect(rolledBack.status).toBe("rolled_back");
    expect(fixture.repository.rollbacks).toHaveLength(1);
    expect(rolledBack.sourceBucket).toBe("products");
    expect(rolledBack.sourceKey).toBe("source.png");
  });

  test("source deletion requires the retention window and a clean run gate", async () => {
    const fixture = await copiedFixture({
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    const verified = await fixture.engine.verify(fixture.copied.id);
    await fixture.engine.cutover(verified.id);
    fixture.repository.deleteGate = {
      completedCutoverAt: new Date("2026-08-31T00:00:00.000Z"),
      unresolvedItems: 0,
      quarantinedItems: 0,
      fallbackReads: 1,
    };

    await expect(fixture.engine.deleteSource(verified.id, {
      confirmedAfter: new Date("2026-09-30T00:00:00.000Z"),
    })).rejects.toThrow("fallback_reads_present");

    fixture.repository.deleteGate.fallbackReads = 0;
    await expect(fixture.engine.deleteSource(verified.id, {
      confirmedAfter: new Date("2026-09-29T23:59:59.000Z"),
    })).rejects.toThrow("retention_window_not_elapsed");
    const deleted = await fixture.engine.deleteSource(verified.id, {
      confirmedAfter: new Date("2026-09-30T00:00:00.000Z"),
    });
    const deletedAgain = await fixture.engine.deleteSource(verified.id, {
      confirmedAfter: new Date("2026-09-30T00:00:00.000Z"),
    });

    expect(deleted.status).toBe("source_deleted");
    expect(deletedAgain.status).toBe("source_deleted");
    expect(fixture.source.removes).toEqual([{
      bucket: "products",
      key: "source.png",
    }]);
  });
});

test("migration 0118 persists intent, target, hashes, and terminal states", () => {
  const migration = readFileSync(
    "drizzle/0118_media_migration_state_machine.sql",
    "utf8",
  );
  expect(migration).toContain('ADD COLUMN "purpose" text');
  expect(migration).toContain('ADD COLUMN "target_id" uuid');
  expect(migration).toContain('ADD COLUMN "source_sha256" varchar(64)');
  expect(migration).toContain('ADD COLUMN "target_sha256" varchar(64)');
  expect(migration).toContain("'cutover'");
  expect(migration).toContain("'source_deleted'");
  expect(migration).toContain("'quarantined'");
  expect(migration).toContain("'skipped'");
});

test("CLI is dry-run by default and inventories every owned legacy domain", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const script = readFileSync(
    "src/scripts/migrate-media-to-r2.ts",
    "utf8",
  );
  for (const command of [
    "inventory",
    "copy",
    "verify",
    "cutover",
    "rollback",
    "delete-source",
  ]) {
    expect(packageJson.scripts[`media:r2:${command}`]).toContain("--dry-run");
  }
  expect(script).toContain('process.argv.includes("--execute")');
  expect(script).toContain('argument("run-id")');
  expect(script).toContain('argument("confirmed-after")');
  expect(script).toContain("from products p");
  expect(script).toContain("from brands");
  expect(script).toContain("from service_attachments");
  expect(script).toContain("from service_customer_request_attachments attachment");
  expect(script).toContain("from service_handover_documents document");
  expect(script).toContain("from ai_chat_messages message");
});

async function copiedFixture(options: { now?: Date } = {}) {
  const repository = new MemoryMigrationRepository();
  const source = new MemoryStorage({
    "products/source.png": Uint8Array.from([1, 2, 3, 4]),
  });
  const target = new MemoryStorage();
  const now = options.now ?? new Date("2026-08-31T00:00:00.000Z");
  const engine = createMediaMigrationEngine({
    repository,
    sourceStorage: source,
    targetStorage: target,
    targetBucket: "lumapos-test-private-media",
    idFactory: () => ITEM_ID,
    now: () => now,
  });
  const item = await engine.inventory({
    runId: RUN_ID,
    storeId: STORE_ID,
    sourceProvider: "supabase",
    sourceBucket: "products",
    sourceKey: "source.png",
    purpose: "product-image",
    targetId: STORE_ID,
    domain: "products",
    visibility: "public",
    originalFileName: "camera.png",
    mimeType: "image/png",
    references: [{ kind: "product-image", recordId: PRODUCT_ID, index: 0 }],
  });
  const copied = await engine.copy(item.id);
  return { repository, source, target, engine, copied };
}

class MemoryMigrationRepository implements MediaMigrationRepository {
  readonly items: MediaMigrationItem[] = [];
  readonly cutovers: string[] = [];
  readonly rollbacks: string[] = [];
  deleteGate = {
    completedCutoverAt: new Date("2026-08-31T00:00:00.000Z"),
    unresolvedItems: 0,
    quarantinedItems: 0,
    fallbackReads: 0,
  };

  async upsertInventoried(input: MediaMigrationItem) {
    const existing = this.items.find((item) =>
      item.runId === input.runId
      && item.sourceProvider === input.sourceProvider
      && item.sourceBucket === input.sourceBucket
      && item.sourceKey === input.sourceKey);
    if (existing) return structuredClone(existing);
    this.items.push(structuredClone(input));
    return structuredClone(input);
  }

  async getItem(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    return item ? structuredClone(item) : null;
  }

  async transition(input: {
    id: string;
    from: MediaMigrationStatus[];
    to: MediaMigrationStatus;
    patch?: Partial<MediaMigrationItem>;
  }) {
    const index = this.items.findIndex((item) => item.id === input.id);
    if (index < 0) throw new Error("migration_item_not_found");
    const current = this.items[index];
    if (!input.from.includes(current.status)) return structuredClone(current);
    this.items[index] = {
      ...current,
      ...structuredClone(input.patch ?? {}),
      status: input.to,
    };
    return structuredClone(this.items[index]);
  }

  async cutoverItem(item: MediaMigrationItem) {
    if (item.status === "cutover") return item;
    this.cutovers.push(item.id);
    return this.transition({
      id: item.id,
      from: ["verified"],
      to: "cutover",
      patch: { cutoverAt: new Date("2026-08-31T00:00:00.000Z") },
    });
  }

  async rollbackItem(item: MediaMigrationItem) {
    if (item.status === "rolled_back") return item;
    this.rollbacks.push(item.id);
    return this.transition({
      id: item.id,
      from: ["cutover"],
      to: "rolled_back",
    });
  }

  async getSourceDeleteGate() {
    return structuredClone(this.deleteGate);
  }
}

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: { bucket: string; key: string }[] = [];
  readonly removes: { bucket: string; key: string }[] = [];

  constructor(seed: Record<string, Uint8Array> = {}) {
    for (const [coordinate, bytes] of Object.entries(seed)) {
      this.objects.set(coordinate, bytes);
    }
  }

  private coordinate(bucket: string, key: string) {
    return `${bucket}/${key}`;
  }

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    ifNoneMatch?: "*";
  }) {
    const coordinate = this.coordinate(input.bucket, input.key);
    if (input.ifNoneMatch === "*" && this.objects.has(coordinate)) {
      throw new Error("precondition_failed");
    }
    this.objects.set(coordinate, input.body.slice());
    this.puts.push({ bucket: input.bucket, key: input.key });
    return {
      sizeBytes: input.body.byteLength,
      contentType: input.contentType,
      etag: null,
    };
  }

  async get(input: { bucket: string; key: string }) {
    const value = this.objects.get(this.coordinate(input.bucket, input.key));
    if (!value) throw new Error("not_found");
    return value.slice();
  }

  async head(input: { bucket: string; key: string }) {
    const value = this.objects.get(this.coordinate(input.bucket, input.key));
    return value ? {
      sizeBytes: value.byteLength,
      contentType: "image/png",
      etag: null,
    } : null;
  }

  async createUploadUrl() {
    throw new Error("not_used");
  }

  async createDownloadUrl() {
    throw new Error("not_used");
  }

  async remove(input: { bucket: string; key: string }) {
    this.objects.delete(this.coordinate(input.bucket, input.key));
    this.removes.push({ bucket: input.bucket, key: input.key });
  }

  publicUrl(input: { key: string }) {
    return `https://media.test/${input.key}`;
  }
}

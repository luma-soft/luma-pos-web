import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mediaLibraryItemIdSchema } from "../src/lib/media/library-source-types";
import { NEW_STORE_FEATURE_DEFAULTS } from "../src/lib/tenancy/store-features";

const storeId = "11111111-1111-4111-8111-111111111111";
const associationId = "22222222-2222-4222-8222-222222222222";
const mediaId = "33333333-3333-4333-8333-333333333333";
const actor = { storeId, userId: associationId, role: "manager" as const, features: NEW_STORE_FEATURE_DEFAULTS };
const signatures: unknown[] = [];
const extractions: unknown[] = [];
let row: Record<string, unknown> | undefined;
let reads = 0;

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: { execute: async () => { reads += 1; return { rows: row ? [row] : [] }; } } }));
mock.module("@/lib/media/config", () => ({ getPublicMediaConfig: () => ({ publicBucket: "public", publicBaseUrl: "https://images.luma.test" }) }));
mock.module("@/lib/media/storage", () => ({ getObjectStorage: () => ({
  createDownloadUrl: async (input: unknown) => { signatures.push(input); return `https://private.luma.test/photo?signature=${signatures.length}`; },
}) }));
mock.module("@/lib/media/service", () => ({
  MediaServiceError: class extends Error {},
  getMediaService: () => ({ extractMetadata: async (...args: unknown[]) => { extractions.push(args); } }),
}));

const { resolveMediaLibraryItem, extractMediaLibraryMetadata, deleteMediaLibraryItem, updateMediaLibraryItem } = await import("../src/lib/media/library");

beforeEach(() => {
  reads = 0;
  signatures.length = 0;
  extractions.length = 0;
  row = {
    id: `sa:${associationId}`, mediaId, album: "Thi công camera", title: "Ảnh công trình",
    note: null, tags: [], createdAt: "2026-09-03T00:00:00Z", uploadedAt: "2026-09-03T00:00:00Z",
    creatorName: "Người chụp", provider: "r2", bucket: "private", objectKey: "project/photo.jpg",
    thumbnailObjectKey: null, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 1024,
    source: { type: "job", id: associationId, label: "Lắp camera", projectId: storeId },
    canExtractMetadata: true, metadata: { version: 1, status: "ready", latitude: 10, longitude: 106 },
  };
});

describe("linked library identity and service boundary", () => {
  test("accepts only recognized association coordinates", () => {
    for (const id of [associationId, `pm:${associationId}`, `sa:${associationId}`, `pu:${associationId}:${"a".repeat(32)}`]) {
      expect(mediaLibraryItemIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of [`pm:${associationId}:extra`, `pu:${associationId}`, `sa:invalid`, `media:${mediaId}`, `pu:${associationId}:${"x".repeat(32)}`, `sa:${associationId}?store=other`]) {
      expect(mediaLibraryItemIdSchema.safeParse(id).success).toBe(false);
    }
  });

  test("private source resolution signs only authorized query rows and is read-only", async () => {
    const item = await resolveMediaLibraryItem(actor, `sa:${associationId}`);
    expect(item.canDelete).toBe(false);
    expect(item.canExtractMetadata).toBe(true);
    expect(item.metadata).toEqual(row!.metadata);
    expect(item.uploadedAt).toBe(row!.uploadedAt as string);
    expect(item).not.toHaveProperty("objectKey");
    expect(item).not.toHaveProperty("bucket");
    expect(signatures).toHaveLength(1);
    row = undefined; // Deleted source, revoked assignment or wrong tenant.
    await expect(resolveMediaLibraryItem(actor, `sa:${associationId}`)).rejects.toMatchObject({ status: 404 });
    expect(signatures).toHaveLength(1);
    expect(extractions).toHaveLength(0);
  });

  test("legacy product images never get fetched/signed or invented size/time metadata", async () => {
    row = { ...row, id: `pu:${associationId}:${"a".repeat(32)}`, mediaId: "", directUrl: "https://old.luma.test/photo.jpg", sizeBytes: 0, sizeKnown: false,
      mimeType: "image/*", uploadedAt: null, canExtractMetadata: false, metadata: null, source: { type: "product", id: associationId, label: "Camera" } };
    const item = await resolveMediaLibraryItem(actor, row.id as string);
    expect(item.url).toBe("https://old.luma.test/photo.jpg");
    expect(item.kind).toBe("image");
    expect(item.mimeType).toBe("image/*");
    expect(item.sizeKnown).toBe(false);
    expect(item.uploadedAt).toBeNull();
    expect(item.canExtractMetadata).toBe(false);
    expect(item.canDelete).toBe(false);
    expect(signatures).toHaveLength(0);
    await expect(extractMediaLibraryMetadata(actor, row.id as string)).rejects.toMatchObject({ status: 403 });
    expect(extractions).toHaveLength(0);
    for (const directUrl of ["javascript:alert(1)", "file:///private/photo.jpg", "https://user:pass@old.luma.test/photo.jpg", "not-a-url"]) {
      row.directUrl = directUrl;
      await expect(resolveMediaLibraryItem(actor, row.id as string)).rejects.toMatchObject({ status: 404 });
    }
  });

  test("source metadata extraction requires its explicit capability and re-resolves afterward", async () => {
    const technician = { ...actor, role: "technician" as const };
    await extractMediaLibraryMetadata(technician, `sa:${associationId}`);
    expect(extractions).toEqual([[technician, mediaId]]);
    expect(reads).toBe(2);
    row!.canExtractMetadata = false;
    await expect(extractMediaLibraryMetadata(actor, `sa:${associationId}`)).rejects.toMatchObject({ status: 403 });
    expect(extractions).toHaveLength(1);
  });

  test("source ids cannot enter manual update/delete or storage deletion paths", async () => {
    for (const id of [`sa:${associationId}`, `pm:${associationId}`, `pu:${associationId}:${"a".repeat(32)}`]) {
      await expect(deleteMediaLibraryItem(actor, id)).rejects.toMatchObject({ status: 404 });
      await expect(updateMediaLibraryItem(actor, { id, title: "Overwrite source" })).rejects.toMatchObject({ status: 400 });
    }
    expect(reads).toBe(0);
    expect(signatures).toHaveLength(0);
  });
});

import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));

import type { MobileGate } from "../src/lib/mobile/auth";
import type { MediaRecord, MediaRepository } from "../src/lib/media/service";
import {
  ObjectStorageWriteError,
  type ObjectStorage,
} from "../src/lib/media/types";

const { createCompleteUploadHandler } = await import(
  "../src/app/api/mobile/media/uploads/[mediaId]/complete/route"
);
const { createUploadIntentHandler } = await import(
  "../src/app/api/mobile/media/uploads/route"
);
const { createDeleteMediaHandler, createResolveMediaHandler } = await import(
  "../src/app/api/mobile/media/[mediaId]/route"
);
const { createMediaService } = await import("../src/lib/media/service");
const { createExtractMetadataHandler } = await import("../src/app/api/mobile/media/[mediaId]/metadata/route");
const { createMediaTargetAuthorizer } = await import(
  "../src/lib/media/authorization"
);

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const CASE_STORE_ID = "a1111111-1111-4111-8111-111111111111";
const CASE_USER_ID = "b2222222-2222-4222-8222-222222222222";
const CASE_PROJECT_ID = "c3333333-3333-4333-8333-333333333333";
const CASE_MEDIA_ID = "d4444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-30T03:00:00.000Z");

const gate: Extract<MobileGate, { ok: true }> = {
  ok: true,
  storeId: STORE_ID,
  userId: USER_ID,
  role: "manager",
  features: {
    camera_quote_builder: true,
    camera_price_list: true,
    hunonic_price_list: true,
    rang_dong_price_list: true,
    field_services: true,
    online_sales: true,
    ai_assistant: true,
    einvoice: true,
  },
};

describe("shared original metadata", () => {
  const context = { params: Promise.resolve({ mediaId: MEDIA_ID }) };
  async function cameraImage() {
    return sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).jpeg()
      .withExif({ IFD0: { Make: "Luma", Model: "Camera" }, IFD2: { DateTimeOriginal: "2026:08:01 10:04:05" } }).toBuffer();
  }

  test("upload completion stores metadata for library, project construction and service evidence", async () => {
    const bytes = await cameraImage();
    for (const purpose of ["library-asset", "project-document", "service-evidence"] as const) {
      const record = pendingRecord({ purpose, mimeType: "image/jpeg", sizeBytes: bytes.length });
      const harness = createHarness({ initial: [record], objectBytes: bytes });
      harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, { sizeBytes: bytes.length, contentType: "image/jpeg", etag: null });
      const response = await harness.complete(jsonRequest({}), context);
      expect(response.status).toBe(200);
      expect((await response.json()).data.metadata).toMatchObject({ status: "ready", make: "Luma", model: "Camera", capturedAt: "2026-08-01T10:04:05", width: 32, height: 24 });
      expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.fileMetadata?.capturedAt).toBe("2026-08-01T10:04:05");
      const reads = harness.storageState.downloads;
      await harness.complete(jsonRequest({}), context);
      expect(harness.storageState.downloads).toBe(reads);
    }
  });

  test("metadata endpoint backfills once, shares concurrent work and never accepts client metadata", async () => {
    const bytes = await cameraImage();
    const record = pendingRecord({ status: "ready", mimeType: "image/jpeg", sizeBytes: bytes.length });
    const harness = createHarness({ initial: [record], objectBytes: bytes });
    const responses = await Promise.all([harness.metadata(jsonRequest({ latitude: 99, capturedAt: "fake" }), context), harness.metadata(jsonRequest({}), context)]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const result = (await response.json()).data.metadata;
      expect(result.capturedAt).toBe("2026-08-01T10:04:05");
      expect(result.latitude).toBeUndefined();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(harness.storageState.downloads).toBe(1);
    await harness.metadata(jsonRequest({}), context);
    expect(harness.storageState.downloads).toBe(1);
  });

  test("tenant, assignment, lifecycle and purpose authorization happen before reading bytes", async () => {
    const record = pendingRecord({ status: "ready", mimeType: "image/jpeg", sizeBytes: 10 });
    for (const options of [
      { initial: [{ ...record, storeId: OTHER_MEDIA_ID }] },
      { initial: [record], authorize: "forbidden" as const },
      { initial: [{ ...record, status: "deleted" as const }] },
      { initial: [{ ...record, status: "pending" as const }] },
      { initial: [{ ...record, purpose: "product-image" as const, visibility: "public" as const }] },
    ]) {
      const harness = createHarness(options);
      const response = await harness.metadata(jsonRequest({}), context);
      expect([400, 404]).toContain(response.status);
      expect(harness.storageState.downloads).toBe(0);
    }
    let called = false;
    const unauthorized = createExtractMetadataHandler({ authenticate: async () => ({ ok: false, error: "errors.unauthorized" }), service: { extractMetadata: async () => { called = true; return { metadata: null }; } } });
    expect((await unauthorized(jsonRequest({}), context)).status).toBe(401);
    expect(called).toBe(false);
  });

  test("failed parsing or persistence never rejects/removes a completed original", async () => {
    const bytes = await cameraImage();
    for (const metadataPersistenceFailure of [false, true]) {
      const record = pendingRecord({ mimeType: "image/jpeg", sizeBytes: bytes.length });
      const harness = createHarness({ initial: [record], objectBytes: metadataPersistenceFailure ? bytes : new Uint8Array(bytes.length), metadataPersistenceFailure });
      harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, { sizeBytes: bytes.length, contentType: "image/jpeg", etag: null });
      const response = await harness.complete(jsonRequest({}), context);
      expect(response.status).toBe(200);
      expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
      expect(harness.storageState.removed).toEqual([]);
      if (!metadataPersistenceFailure) expect((await response.json()).data.metadata.status).toBe("failed");
    }
  });

  test("concurrent metadata persistence failure remains best-effort for every caller", async () => {
    const bytes = await cameraImage();
    const record = pendingRecord({ status: "ready", mimeType: "image/jpeg", sizeBytes: bytes.length });
    const harness = createHarness({ initial: [record], objectBytes: bytes, metadataPersistenceFailure: true });
    const responses = await Promise.all([
      harness.complete(jsonRequest({}), context),
      harness.metadata(jsonRequest({}), context),
    ]);
    for (const response of responses) expect(response.status).toBe(200);
    expect(harness.storageState.downloads).toBe(1);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
    expect(harness.storageState.removed).toEqual([]);
  });
});

function jsonRequest(body: unknown, url = "https://app.test/api/mobile/media/uploads") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mediaRequest(mediaId = MEDIA_ID, method = "GET") {
  return new Request(`https://app.test/api/mobile/media/${mediaId}`, { method });
}

function pendingRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: MEDIA_ID,
    storeId: STORE_ID,
    provider: "r2",
    visibility: "private",
    purpose: "project-document",
    targetId: PROJECT_ID,
    domain: "projects",
    bucket: "private-media",
    objectKey: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.pdf`,
    originalFileName: "nghiem-thu.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "pending",
    createdBy: USER_ID,
    createdAt: NOW,
    uploadExpiresAt: new Date(NOW.getTime() + 600_000),
    readyAt: null,
    verifiedAt: null,
    deletedAt: null,
    thumbnailObjectKey: null,
    thumbnailSizeBytes: null,
    sha256: null,
    ...overrides,
  };
}

function createHarness(options: {
  now?: Date;
  authorize?: "allowed" | "forbidden" | "not_found";
  initial?: MediaRecord[];
  protectedDelete?: boolean;
  mutateTargetBeforeDelete?: string;
  objectBytes?: Uint8Array;
  originalPutFailure?: "definitive" | "ambiguous-before" | "ambiguous-after";
  failCompletionHead?: boolean;
  failDownloadSign?: boolean;
  readyRecoveryOutcome?: "deleted" | "quarantined" | "referenced" | "conflict";
  readyRecoveryFailure?: boolean;
  metadataPersistenceFailure?: boolean;
} = {}) {
  const records = new Map(
    (options.initial ?? []).map((record) => [`${record.storeId}:${record.id}`, record]),
  );
  const storageState = {
    heads: new Map<string, { sizeBytes: number; contentType: string | null; etag: string | null }>(),
    removed: [] as Array<{ bucket: string; key: string }>,
    puts: [] as Array<{
      bucket: string;
      key: string;
      contentType: string;
      sizeBytes: number;
      ifNoneMatch?: "*";
    }>,
    downloads: 0,
    uploadIntents: [] as Array<{
      bucket: string;
      key: string;
      contentType: string;
      expiresInSeconds: number;
      ifNoneMatch?: string;
    }>,
  };
  const readyRecoveryCalls: unknown[] = [];

  const repository: MediaRepository = {
    async createPending(input) {
      const record = pendingRecord({
        ...input,
        createdAt: options.now ?? NOW,
        readyAt: null,
        verifiedAt: null,
        deletedAt: null,
        thumbnailObjectKey: null,
        thumbnailSizeBytes: null,
      });
      records.set(`${record.storeId}:${record.id}`, record);
      return record;
    },
    async reservePending(input) {
      const key = `${input.storeId}:${input.id}`;
      const existing = records.get(key);
      if (existing) return { media: existing, created: false };
      const record = pendingRecord({
        ...input,
        createdAt: options.now ?? NOW,
        readyAt: null,
        verifiedAt: null,
        deletedAt: null,
        thumbnailObjectKey: null,
        thumbnailSizeBytes: null,
      });
      records.set(key, record);
      return { media: record, created: true };
    },
    async getForStore(input) {
      return records.get(`${input.storeId}:${input.mediaId}`) ?? null;
    },
    async withReservedUploadLock(input, operation) {
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (!current) return null;
      return operation({
        media: current,
        async markReady(value) {
          const pending = records.get(`${value.storeId}:${value.mediaId}`);
          if (!pending || pending.status !== "pending") return null;
          const ready = {
            ...pending,
            status: "ready" as const,
            sizeBytes: value.actualSizeBytes,
            readyAt: value.readyAt,
            verifiedAt: value.verifiedAt,
          };
          records.set(`${ready.storeId}:${ready.id}`, ready);
          return ready;
        },
        async abandonPending(value) {
          const pending = records.get(`${value.storeId}:${value.mediaId}`);
          if (!pending || pending.status !== "pending") return null;
          const deleted = {
            ...pending,
            status: "deleted" as const,
            deletedAt: value.deletedAt,
          };
          records.set(`${deleted.storeId}:${deleted.id}`, deleted);
          return deleted;
        },
        async quarantinePending(value) {
          const pending = records.get(`${value.storeId}:${value.mediaId}`);
          if (!pending || pending.status !== "pending") return null;
          const quarantined = {
            ...pending,
            status: "quarantined" as const,
            deletedAt: null,
          };
          records.set(`${quarantined.storeId}:${quarantined.id}`, quarantined);
          return quarantined;
        },
      });
    },
    async markReady(input) {
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (!current || current.status !== "pending") return null;
      const ready = {
        ...current,
        status: "ready" as const,
        sizeBytes: input.actualSizeBytes,
        readyAt: input.readyAt,
        verifiedAt: input.verifiedAt,
      };
      records.set(key, ready);
      return ready;
    },
    async saveThumbnail(input) {
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (!current || current.status !== "ready") return null;
      const updated = {
        ...current,
        thumbnailObjectKey: input.objectKey,
        thumbnailSizeBytes: input.sizeBytes,
      };
      records.set(key, updated);
      return updated;
    },
    async saveMetadata(input) {
      if (options.metadataPersistenceFailure) throw new Error("Database unavailable");
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (!current || current.status !== "ready") return null;
      if (current.fileMetadata && current.fileMetadata.status !== "failed") return null;
      const updated = { ...current, fileMetadata: input.metadata };
      records.set(key, updated);
      return updated;
    },
    async softDeleteIfUnreferenced(input) {
      if (options.readyRecoveryOutcome) return { outcome: "conflict" };
      if (options.protectedDelete) return { outcome: "referenced" };
      const key = `${input.storeId}:${input.mediaId}`;
      let current = records.get(key);
      if (!current || current.status !== "ready") return { outcome: "conflict" };
      if (options.mutateTargetBeforeDelete) {
        current = { ...current, targetId: options.mutateTargetBeforeDelete };
        records.set(key, current);
      }
      if (
        current.purpose !== input.expectedPurpose
        || current.targetId !== input.expectedTargetId
      ) {
        return { outcome: "conflict" };
      }
      const deleted = {
        ...current,
        status: "deleted" as const,
        deletedAt: input.deletedAt,
      };
      records.set(key, deleted);
      return { outcome: "deleted", media: deleted };
    },
    async recoverReadyAfterFailure(input) {
      readyRecoveryCalls.push(input);
      if (options.readyRecoveryFailure) {
        throw new Error("recovery database unavailable");
      }
      const outcome = options.readyRecoveryOutcome ?? "deleted";
      if (outcome === "referenced" || outcome === "conflict") return { outcome };
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (!current) return { outcome: "conflict" };
      const recovered = {
        ...current,
        status: outcome,
        deletedAt: outcome === "deleted" ? input.recoveredAt : null,
      } as MediaRecord;
      records.set(key, recovered);
      return { outcome, media: recovered };
    },
    async abandonPending(input) {
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (
        !current
        || current.status !== "pending"
        || current.purpose !== input.expectedPurpose
        || current.targetId !== input.expectedTargetId
      ) return null;
      const deleted = {
        ...current,
        status: "deleted" as const,
        deletedAt: input.deletedAt,
      };
      records.set(key, deleted);
      return deleted;
    },
    async quarantinePending(input) {
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (
        !current
        || current.status !== "pending"
        || current.purpose !== input.expectedPurpose
        || current.targetId !== input.expectedTargetId
      ) return null;
      const quarantined = {
        ...current,
        status: "quarantined" as const,
        deletedAt: null,
      };
      records.set(key, quarantined);
      return quarantined;
    },
  };

  const storage: ObjectStorage = {
    async put(input) {
      storageState.puts.push({
        bucket: input.bucket,
        key: input.key,
        contentType: input.contentType,
        sizeBytes: input.body.byteLength,
        ifNoneMatch: input.ifNoneMatch,
      });
      const coordinate = `${input.bucket}:${input.key}`;
      if (input.ifNoneMatch === "*" && storageState.heads.has(coordinate)) {
        throw new ObjectStorageWriteError(
          "precondition failed",
          "definitive-no-write",
        );
      }
      if (input.ifNoneMatch === "*" && options.originalPutFailure === "definitive") {
        throw new ObjectStorageWriteError(
          "request rejected before write",
          "definitive-no-write",
        );
      }
      if (input.ifNoneMatch === "*" && options.originalPutFailure === "ambiguous-before") {
        throw new ObjectStorageWriteError(
          "connection lost before response",
          "ambiguous",
        );
      }
      storageState.heads.set(coordinate, {
        sizeBytes: input.body.byteLength,
        contentType: input.contentType,
        etag: "put",
      });
      if (input.ifNoneMatch === "*" && options.originalPutFailure === "ambiguous-after") {
        throw new ObjectStorageWriteError(
          "connection lost after commit",
          "ambiguous",
        );
      }
      return { sizeBytes: input.body.byteLength, contentType: input.contentType, etag: "thumb" };
    },
    async get() {
      storageState.downloads += 1;
      return options.objectBytes ?? new Uint8Array([1, 2, 3]);
    },
    async head(input) {
      const head = storageState.heads.get(`${input.bucket}:${input.key}`) ?? null;
      return head && options.failCompletionHead
        ? { ...head, sizeBytes: head.sizeBytes + 1 }
        : head;
    },
    async createUploadUrl(input) {
      storageState.uploadIntents.push(input);
      return `https://r2.test/${input.bucket}/${input.key}?X-Amz-Expires=${input.expiresInSeconds}&X-Amz-Signature=upload`;
    },
    async createDownloadUrl(input) {
      if (options.failDownloadSign) throw new Error("private signing failed");
      return `https://r2.test/${input.bucket}/${input.key}?X-Amz-Expires=${input.expiresInSeconds}&X-Amz-Signature=download`;
    },
    async remove(input) {
      storageState.removed.push(input);
    },
    publicUrl(input) {
      return `https://media.lumapos.shop/${input.key}`;
    },
  };

  const service = createMediaService({
    storage,
    repository,
    config: { publicBucket: "public-media", privateBucket: "private-media" },
    authorizeTarget: async () => options.authorize ?? "allowed",
    now: () => options.now ?? NOW,
    randomUUID: () => MEDIA_ID,
    logger: { error() {} },
  });
  const authenticate = async () => gate;

  return {
    records,
    readyRecoveryCalls,
    storageState,
    service,
    upload: createUploadIntentHandler({ authenticate, service }),
    complete: createCompleteUploadHandler({ authenticate, service }),
    resolve: createResolveMediaHandler({ authenticate, service }),
    remove: createDeleteMediaHandler({ authenticate, service }),
    metadata: createExtractMetadataHandler({ authenticate, service }),
    async putOriginal(
      mediaId: string,
      body: Uint8Array,
      contentType: string,
      ifNoneMatch: string | null,
    ) {
      const record = records.get(`${STORE_ID}:${mediaId}`);
      if (!record) throw new Error("missing media intent");
      const intent = storageState.uploadIntents.find((candidate) =>
        candidate.bucket === record.bucket && candidate.key === record.objectKey
      );
      if (intent?.ifNoneMatch !== "*" || ifNoneMatch !== "*") {
        throw new Error("unsigned create-only precondition");
      }
      const coordinate = `${record.bucket}:${record.objectKey}`;
      if (storageState.heads.has(coordinate)) {
        throw Object.assign(new Error("precondition failed"), { status: 412 });
      }
      storageState.heads.set(coordinate, {
        sizeBytes: body.byteLength,
        contentType,
        etag: "original",
      });
    },
  };
}

describe("media upload intent API", () => {
  test("private upload intent binds tenant, purpose, target, type, size, and ten-minute expiry", async () => {
    const harness = createHarness();
    const response = await harness.upload(jsonRequest({
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "nghiem-thu.pdf",
      mimeType: "APPLICATION/PDF",
      sizeBytes: 1024,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        media: {
          id: MEDIA_ID,
          visibility: "private",
          status: "pending",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          fileName: "nghiem-thu.pdf",
        },
        method: "PUT",
        uploadUrl: expect.stringContaining("X-Amz-Signature=upload"),
        headers: {
          "Content-Type": "application/pdf",
          "If-None-Match": "*",
        },
        expiresAt: "2026-08-30T03:10:00.000Z",
      },
    });

    const stored = harness.records.get(`${STORE_ID}:${MEDIA_ID}`);
    expect(stored).toMatchObject({
      storeId: STORE_ID,
      purpose: "project-document",
      targetId: PROJECT_ID,
      domain: "projects",
      bucket: "private-media",
      originalFileName: "nghiem-thu.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      status: "pending",
    });
    expect(stored?.objectKey).toBe(
      `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.pdf`,
    );
  });

  test("canonicalizes UUID actor and target coordinates before persistence", async () => {
    const harness = createHarness();
    const uppercaseActor = {
      ...gate,
      storeId: CASE_STORE_ID.toUpperCase(),
      userId: CASE_USER_ID.toUpperCase(),
    };

    await expect(harness.service.createUploadIntent(uppercaseActor, {
      purpose: "project-document",
      targetId: CASE_PROJECT_ID.toUpperCase(),
      fileName: "uuid-case.pdf",
      mimeType: "application/pdf",
      sizeBytes: 16,
    })).resolves.toMatchObject({ media: { id: MEDIA_ID } });

    const stored = harness.records.get(`${CASE_STORE_ID}:${MEDIA_ID}`);
    expect(stored).toMatchObject({
      storeId: CASE_STORE_ID,
      targetId: CASE_PROJECT_ID,
      createdBy: CASE_USER_ID,
    });
    expect(stored?.objectKey).toBe(
      `stores/${CASE_STORE_ID}/projects/2026/08/${MEDIA_ID}/original.pdf`,
    );
  });

  test("create-only upload cannot overwrite the immutable object after completion", async () => {
    const harness = createHarness();
    const intent = await harness.upload(jsonRequest({
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "nghiem-thu.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
    }));
    expect(intent.status).toBe(200);
    expect((await intent.json()).data.headers).toEqual({
      "Content-Type": "application/pdf",
      "If-None-Match": "*",
    });

    await harness.putOriginal(MEDIA_ID, new Uint8Array([1, 2, 3]), "application/pdf", "*");
    const complete = await harness.complete(jsonRequest({}), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });
    expect(complete.status).toBe(200);

    await expect(
      harness.putOriginal(MEDIA_ID, new Uint8Array([4, 5, 6]), "application/pdf", "*"),
    ).rejects.toMatchObject({ status: 412 });
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });

  test("public product staging uses the store UUID target and an immutable public bucket key", async () => {
    const harness = createHarness();
    const response = await harness.upload(jsonRequest({
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "../../../Khách Hàng.exe",
      mimeType: "image/png",
      sizeBytes: 512,
    }));

    expect(response.status).toBe(400);
    expect(harness.records.size).toBe(0);

    const accepted = await harness.upload(jsonRequest({
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "camera-front.png",
      mimeType: "image/png",
      sizeBytes: 512,
    }));
    expect(accepted.status).toBe(200);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)).toMatchObject({
      visibility: "public",
      bucket: "public-media",
      targetId: STORE_ID,
    });
  });

  test("rejects malformed and over-policy inputs before creating a pending row", async () => {
    const invalid = [
      { purpose: "avatar", targetId: PROJECT_ID, fileName: "a.png", mimeType: "image/png", sizeBytes: 1 },
      { purpose: "project-document", targetId: "not-a-uuid", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 },
      { purpose: "project-document", targetId: PROJECT_ID, fileName: "", mimeType: "application/pdf", sizeBytes: 1 },
      { purpose: "project-document", targetId: PROJECT_ID, fileName: "a.pdf", mimeType: "application/x-msdownload", sizeBytes: 1 },
      { purpose: "product-image", targetId: STORE_ID, fileName: "a.svg", mimeType: "image/svg+xml", sizeBytes: 1 },
      { purpose: "service-evidence", targetId: PROJECT_ID, fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 0 },
      { purpose: "service-evidence", targetId: PROJECT_ID, fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 15 * 1024 * 1024 + 1 },
    ];

    for (const body of invalid) {
      const harness = createHarness();
      const response = await harness.upload(jsonRequest(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "errors.invalidData" });
      expect(harness.records.size).toBe(0);
    }
  });

  test("target authorization fails closed before creating a pending row", async () => {
    const harness = createHarness({ authorize: "not_found" });
    const response = await harness.upload(jsonRequest({
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "secret.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    }));

    expect(response.status).toBe(404);
    expect(harness.records.size).toBe(0);
  });
});

describe("media completion API", () => {
  test("HEAD exact size and normalized content type transitions pending media to ready", async () => {
    const record = pendingRecord();
    const harness = createHarness({ initial: [record] });
    harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, {
      sizeBytes: 1024,
      contentType: "Application/PDF",
      etag: "etag-1",
    });

    const response = await harness.complete(
      jsonRequest({}, `https://app.test/api/mobile/media/uploads/${MEDIA_ID}/complete`),
      { params: Promise.resolve({ mediaId: MEDIA_ID }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        id: MEDIA_ID,
        visibility: "private",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        fileName: "nghiem-thu.pdf",
        metadata: { version: 1, status: "unsupported", extractedAt: NOW.toISOString() },
        canExtractMetadata: true,
        createdAt: NOW.toISOString(),
        createdBy: USER_ID,
        url: expect.stringContaining("X-Amz-Expires=900"),
        thumbnailUrl: null,
      },
    });
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });

  test("wrong HEAD size or MIME never marks the original ready", async () => {
    for (const head of [
      { sizeBytes: 1025, contentType: "application/pdf", etag: null },
      { sizeBytes: 1024, contentType: "text/plain", etag: null },
      { sizeBytes: 1024, contentType: "application/pdf; charset=utf-8", etag: null },
    ]) {
      const record = pendingRecord();
      const harness = createHarness({ initial: [record] });
      harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, head);
      const response = await harness.complete(jsonRequest({}), {
        params: Promise.resolve({ mediaId: MEDIA_ID }),
      });
      expect(response.status).toBe(409);
      expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("pending");
    }
  });

  test("expired pending intent is rejected before HEAD and stays pending", async () => {
    const record = pendingRecord();
    const harness = createHarness({
      now: new Date("2026-08-30T03:10:00.000Z"),
      initial: [record],
    });
    const response = await harness.complete(jsonRequest({}), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(410);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("pending");
  });

  test("ready completion is idempotent and does not HEAD the object again", async () => {
    const harness = createHarness({ initial: [pendingRecord({ status: "ready" })] });
    const response = await harness.complete(jsonRequest({}), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.id).toBe(MEDIA_ID);
  });

  test("quarantined and deleted media cannot be completed", async () => {
    for (const status of ["quarantined", "deleted"] as const) {
      const harness = createHarness({ initial: [pendingRecord({ status })] });
      const response = await harness.complete(jsonRequest({}), {
        params: Promise.resolve({ mediaId: MEDIA_ID }),
      });
      expect(response.status).toBe(404);
    }
  });

  test("safe raster completion saves the deterministic thumbnail coordinate", async () => {
    const image = new Uint8Array(await (await import("sharp")).default({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    }).png().toBuffer());
    const objectKey = `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.png`;
    const record = pendingRecord({
      visibility: "public",
      purpose: "product-image",
      targetId: STORE_ID,
      domain: "products",
      bucket: "public-media",
      objectKey,
      mimeType: "image/png",
      sizeBytes: image.byteLength,
    });
    const harness = createHarness({ initial: [record], objectBytes: image });
    harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, {
      sizeBytes: image.byteLength,
      contentType: "image/png",
      etag: "image",
    });

    const response = await harness.complete(jsonRequest({}), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(200);
    expect(harness.storageState.puts).toEqual([{
      bucket: "public-media",
      key: `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/thumbnail.webp`,
      contentType: "image/webp",
      sizeBytes: expect.any(Number),
    }]);
    expect((await response.json()).data.thumbnailUrl).toBe(
      `https://media.lumapos.shop/stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/thumbnail.webp`,
    );
  });

  test("thumbnail failure keeps a validated original ready with a null thumbnail", async () => {
    const record = pendingRecord({
      objectKey: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
      mimeType: "image/jpeg",
    });
    const harness = createHarness({ initial: [record] });
    harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, {
      sizeBytes: record.sizeBytes,
      contentType: record.mimeType,
      etag: "image",
    });

    const response = await harness.complete(jsonRequest({}), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data.thumbnailUrl).toBeNull();
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });
});

describe("server managed object writes", () => {
  test("reserves one managed-media id for an exact repeated request", async () => {
    const harness = createHarness();
    const request = {
      reservationId: MEDIA_ID,
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "nghiem-thu.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    };

    expect(await harness.service.reserveManagedObject(gate, request)).toMatchObject({
      mediaId: MEDIA_ID,
      created: true,
      status: "pending",
    });
    expect(await harness.service.reserveManagedObject(gate, request)).toMatchObject({
      mediaId: MEDIA_ID,
      created: false,
      status: "pending",
    });
    expect(harness.records.size).toBe(1);
  });

  test("resumes the exact pending object after an ambiguous-after managed PUT", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const harness = createHarness({
      objectBytes: bytes,
      originalPutFailure: "ambiguous-after",
    });
    await harness.service.reserveManagedObject(gate, {
      reservationId: MEDIA_ID,
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "nghiem-thu.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    await expect(harness.service.putReservedManagedObject(
      gate,
      MEDIA_ID,
      bytes,
    )).rejects.toThrow("connection lost after commit");
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("pending");

    expect(await harness.service.putReservedManagedObject(
      gate,
      MEDIA_ID,
      bytes,
    )).toMatchObject({ mediaId: MEDIA_ID });
    expect(harness.storageState.puts).toHaveLength(1);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });

  test("reconciles an ambiguous-after object after the upload window expires", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const record = pendingRecord({
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const harness = createHarness({
      now: new Date("2026-08-30T03:10:00.000Z"),
      initial: [record],
      objectBytes: bytes,
    });
    harness.storageState.heads.set(`${record.bucket}:${record.objectKey}`, {
      sizeBytes: bytes.byteLength,
      contentType: record.mimeType,
      etag: "ambiguous-after",
    });

    await expect(harness.service.putReservedManagedObject(
      gate,
      MEDIA_ID,
      bytes,
    )).resolves.toMatchObject({ mediaId: MEDIA_ID, path: record.objectKey });
    expect(harness.storageState.puts).toEqual([]);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });

  test("writes bytes directly with create-only semantics, verifies, and returns public coordinates", async () => {
    const harness = createHarness();
    const result = await harness.service.putManagedObject(gate, {
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "camera.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0x00]));

    const path = `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.jpg`;
    expect(result).toEqual({
      mediaId: MEDIA_ID,
      path,
      url: `https://media.lumapos.shop/${path}`,
    });
    expect(harness.storageState.uploadIntents).toEqual([]);
    expect(harness.storageState.puts[0]).toEqual({
      bucket: "public-media",
      key: path,
      contentType: "image/jpeg",
      sizeBytes: 4,
      ifNoneMatch: "*",
    });
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });

  test("abandons pending metadata only after a definitive no-write failure", async () => {
    const harness = createHarness({ originalPutFailure: "definitive" });
    await expect(harness.service.putManagedObject(gate, {
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "camera.png",
      mimeType: "image/png",
      sizeBytes: 4,
    }, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).rejects.toThrow();

    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("deleted");
    expect(harness.storageState.removed).toEqual([]);
  });

  test.each(["ambiguous-before", "ambiguous-after"] as const)(
    "keeps metadata pending after an %s PUT failure for later reconciliation",
    async (originalPutFailure: "ambiguous-before" | "ambiguous-after") => {
      const harness = createHarness({ originalPutFailure });
      await expect(harness.service.putManagedObject(gate, {
        purpose: "product-image",
        targetId: STORE_ID,
        fileName: "camera.png",
        mimeType: "image/png",
        sizeBytes: 4,
      }, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).rejects.toThrow();

      expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("pending");
      expect(harness.storageState.removed).toEqual([]);
      const key = `public-media:stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.png`;
      expect(harness.storageState.heads.has(key)).toBe(
        originalPutFailure === "ambiguous-after",
      );
    },
  );

  test("never removes a pre-existing object after a create-only conflict", async () => {
    const harness = createHarness();
    const key = `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.png`;
    harness.storageState.heads.set(`public-media:${key}`, {
      sizeBytes: 99,
      contentType: "image/png",
      etag: "pre-existing",
    });

    await expect(harness.service.putManagedObject(gate, {
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "camera.png",
      mimeType: "image/png",
      sizeBytes: 4,
    }, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).rejects.toThrow();

    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("deleted");
    expect(harness.storageState.removed).toEqual([]);
    expect(harness.storageState.heads.get(`public-media:${key}`)?.etag)
      .toBe("pre-existing");
  });

  test("removes the create-only object when completion fails before ready", async () => {
    const harness = createHarness({ failCompletionHead: true });
    await expect(harness.service.putManagedObject(gate, {
      purpose: "product-image",
      targetId: STORE_ID,
      fileName: "camera.png",
      mimeType: "image/png",
      sizeBytes: 4,
    }, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).rejects.toThrow(
      "media.uploadMismatch",
    );

    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("deleted");
    expect(harness.storageState.removed).toEqual([{
      bucket: "public-media",
      key: `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.png`,
    }]);
  });

  test("soft-deletes an unreferenced ready object when private signing fails", async () => {
    const harness = createHarness({ failDownloadSign: true });
    await expect(harness.service.putManagedObject(gate, {
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "handover.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    }, Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).rejects.toThrow(
      "private signing failed",
    );

    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("deleted");
    expect(harness.storageState.removed).toEqual([]);
  });

  test("quarantines a ready object when signing recovery is reference-indeterminate", async () => {
    const harness = createHarness({
      failDownloadSign: true,
      readyRecoveryOutcome: "quarantined",
    });
    await expect(harness.service.putManagedObject(gate, {
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "handover.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    }, Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).rejects.toThrow(
      "private signing failed",
    );

    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status)
      .toBe("quarantined");
    expect(harness.readyRecoveryCalls).toEqual([{
      storeId: STORE_ID,
      mediaId: MEDIA_ID,
      expectedPurpose: "project-document",
      expectedTargetId: PROJECT_ID,
      expectedObjectKey: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.pdf`,
      expectedCreatedBy: USER_ID,
      recoveredAt: NOW,
    }]);
  });

  test("keeps a ready object when signing recovery finds a live reference", async () => {
    const harness = createHarness({
      failDownloadSign: true,
      readyRecoveryOutcome: "referenced",
    });
    await expect(harness.service.putManagedObject(gate, {
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "referenced.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    }, Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).rejects.toThrow(
      "private signing failed",
    );

    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
    expect(harness.readyRecoveryCalls).toHaveLength(1);
    expect(harness.storageState.removed).toEqual([]);
  });

  test("surfaces conflict or database failure from ready signing recovery", async () => {
    const conflict = createHarness({
      failDownloadSign: true,
      readyRecoveryOutcome: "conflict",
    });
    await expect(conflict.service.putManagedObject(gate, {
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "conflict.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    }, Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).rejects.toThrow(
      "media.readyRecoveryConflict",
    );
    expect(conflict.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");

    const failed = createHarness({
      failDownloadSign: true,
      readyRecoveryFailure: true,
    });
    await expect(failed.service.putManagedObject(gate, {
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "database-error.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    }, Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).rejects.toThrow(
      "recovery database unavailable",
    );
    expect(failed.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
  });
});

describe("target-aware media authorization", () => {
  function authorizerHarness() {
    const state = {
      products: new Set<string>(),
      projects: new Map<string, { serviceType: string | null }>(),
      serviceJobs: new Map<string, { assignedTo: string | null }>(),
      projectAssignments: new Set<string>(),
      jobAssignments: new Set<string>(),
      aiSessions: new Set<string>(),
    };
    return {
      state,
      authorize: createMediaTargetAuthorizer({
        async productExists(storeId, targetId) {
          return state.products.has(`${storeId}:${targetId}`);
        },
        async getProject(storeId, targetId) {
          return state.projects.get(`${storeId}:${targetId}`) ?? null;
        },
        async technicianCanAccessProject(storeId, projectId, userId) {
          return state.projectAssignments.has(`${storeId}:${projectId}:${userId}`);
        },
        async getServiceJob(storeId, jobId) {
          return state.serviceJobs.get(`${storeId}:${jobId}`) ?? null;
        },
        async technicianAssignedToJob(storeId, jobId, userId) {
          return state.jobAssignments.has(`${storeId}:${jobId}:${userId}`);
        },
        async ownsAiSession(storeId, sessionId, userId) {
          return state.aiSessions.has(`${storeId}:${sessionId}:${userId}`);
        },
      }),
    };
  }

  test("product image allows only stock roles and store staging or a tenant product", async () => {
    const { state, authorize } = authorizerHarness();
    const warehouse = { ...gate, role: "warehouse" as const };
    expect(await authorize({ actor: warehouse, purpose: "product-image", targetId: STORE_ID }))
      .toBe("allowed");
    expect(await authorize({ actor: warehouse, purpose: "product-image", targetId: PROJECT_ID }))
      .toBe("not_found");
    state.products.add(`${STORE_ID}:${PROJECT_ID}`);
    expect(await authorize({ actor: warehouse, purpose: "product-image", targetId: PROJECT_ID }))
      .toBe("allowed");
    expect(await authorize({ actor: { ...gate, role: "cashier" }, purpose: "product-image", targetId: STORE_ID }))
      .toBe("forbidden");
  });

  test("treats UUID-equivalent actor and staging target spellings as the same store", async () => {
    const { state, authorize } = authorizerHarness();
    const warehouse = {
      ...gate,
      storeId: CASE_STORE_ID.toUpperCase(),
      userId: CASE_USER_ID.toUpperCase(),
      role: "warehouse" as const,
    };
    await expect(authorize({
      actor: warehouse,
      purpose: "product-image",
      targetId: CASE_STORE_ID,
    })).resolves.toBe("allowed");

    state.serviceJobs.set(`${CASE_STORE_ID}:${CASE_PROJECT_ID}`, {
      assignedTo: CASE_USER_ID,
    });
    await expect(authorize({
      actor: { ...warehouse, role: "technician" as const },
      purpose: "service-evidence",
      targetId: CASE_PROJECT_ID.toUpperCase(),
    })).resolves.toBe("allowed");
  });

  test("service project and evidence access require tenant targets plus technician assignment", async () => {
    const { state, authorize } = authorizerHarness();
    const technician = { ...gate, role: "technician" as const };
    state.projects.set(`${STORE_ID}:${PROJECT_ID}`, { serviceType: "camera" });
    expect(await authorize({ actor: technician, purpose: "project-document", targetId: PROJECT_ID }))
      .toBe("forbidden");
    state.projectAssignments.add(`${STORE_ID}:${PROJECT_ID}:${USER_ID}`);
    expect(await authorize({ actor: technician, purpose: "project-document", targetId: PROJECT_ID }))
      .toBe("allowed");

    state.serviceJobs.set(`${STORE_ID}:${PROJECT_ID}`, { assignedTo: null });
    expect(await authorize({ actor: technician, purpose: "service-evidence", targetId: PROJECT_ID }))
      .toBe("forbidden");
    state.jobAssignments.add(`${STORE_ID}:${PROJECT_ID}:${USER_ID}`);
    expect(await authorize({ actor: technician, purpose: "service-evidence", targetId: PROJECT_ID }))
      .toBe("allowed");
  });

  test("AI attachment requires entitlement and a session owned in the active store", async () => {
    const { state, authorize } = authorizerHarness();
    expect(await authorize({ actor: gate, purpose: "ai-attachment", targetId: PROJECT_ID }))
      .toBe("not_found");
    state.aiSessions.add(`${STORE_ID}:${PROJECT_ID}:${USER_ID}`);
    expect(await authorize({ actor: gate, purpose: "ai-attachment", targetId: PROJECT_ID }))
      .toBe("allowed");
    const disabled = { ...gate, features: { ...gate.features, ai_assistant: false } };
    expect(await authorize({ actor: disabled, purpose: "ai-attachment", targetId: PROJECT_ID }))
      .toBe("forbidden");
  });
});

describe("media resolve and delete API", () => {
  test("reads authorized ready private media bytes without exposing storage coordinates", async () => {
    const bytes = Uint8Array.from([9, 8, 7, 6]);
    const harness = createHarness({
      initial: [pendingRecord({
        purpose: "ai-attachment",
        targetId: PROJECT_ID,
        domain: "ai",
        bucket: "private-media",
        objectKey: `stores/${STORE_ID}/ai/2026/08/${MEDIA_ID}/original.png`,
        originalFileName: "hoa-don.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        status: "ready",
        readyAt: NOW,
      })],
      objectBytes: bytes,
    });

    await expect(harness.service.readMedia(gate, MEDIA_ID)).resolves.toEqual({
      bytes,
      media: expect.objectContaining({
        id: MEDIA_ID,
        purpose: "ai-attachment",
        targetId: PROJECT_ID,
        mimeType: "image/png",
      }),
    });
    expect(harness.storageState.downloads).toBe(1);
  });

  test("resolves, signs, and soft-deletes with UUID-equivalent casing", async () => {
    const ready = pendingRecord({
      id: CASE_MEDIA_ID,
      storeId: CASE_STORE_ID,
      targetId: CASE_PROJECT_ID,
      createdBy: CASE_USER_ID,
      objectKey: `stores/${CASE_STORE_ID}/projects/2026/08/${CASE_MEDIA_ID}/original.pdf`,
      status: "ready",
      readyAt: NOW,
    });
    const harness = createHarness({ initial: [ready] });
    const uppercaseActor = {
      ...gate,
      storeId: CASE_STORE_ID.toUpperCase(),
      userId: CASE_USER_ID.toUpperCase(),
    };

    await expect(harness.service.resolveMedia(
      uppercaseActor,
      CASE_MEDIA_ID.toUpperCase(),
    )).resolves.toMatchObject({
      id: CASE_MEDIA_ID,
      url: expect.stringContaining("X-Amz-Signature=download"),
    });
    await expect(harness.service.deleteMedia(
      uppercaseActor,
      CASE_MEDIA_ID.toUpperCase(),
    )).resolves.toEqual({ id: CASE_MEDIA_ID, status: "deleted" });
    expect(harness.records.get(`${CASE_STORE_ID}:${CASE_MEDIA_ID}`)?.status).toBe("deleted");
  });

  test("deletes a managed product path with UUID-equivalent actor coordinates", async () => {
    const objectKey = `stores/${CASE_STORE_ID}/products/2026/08/${CASE_MEDIA_ID}/original.png`;
    const harness = createHarness({
      initial: [pendingRecord({
        id: CASE_MEDIA_ID,
        storeId: CASE_STORE_ID,
        visibility: "public",
        purpose: "product-image",
        targetId: CASE_STORE_ID,
        domain: "products",
        bucket: "public-media",
        objectKey,
        originalFileName: "camera.png",
        mimeType: "image/png",
        status: "ready",
        readyAt: NOW,
      })],
    });
    await expect(harness.service.deleteManagedProductImageByPath({
      ...gate,
      storeId: CASE_STORE_ID.toUpperCase(),
      userId: CASE_USER_ID.toUpperCase(),
    }, objectKey)).resolves.toEqual({ id: CASE_MEDIA_ID, status: "deleted" });
  });

  test("cross-store media resolution is not found", async () => {
    const harness = createHarness({
      initial: [pendingRecord({ id: OTHER_MEDIA_ID, storeId: "66666666-6666-4666-8666-666666666666", status: "ready" })],
    });
    const response = await harness.resolve(mediaRequest(OTHER_MEDIA_ID), {
      params: Promise.resolve({ mediaId: OTHER_MEDIA_ID }),
    });
    expect(response.status).toBe(404);
  });

  test("unauthorized private resolution is not found and never signs a URL", async () => {
    const harness = createHarness({ authorize: "forbidden", initial: [pendingRecord({ status: "ready" })] });
    const response = await harness.resolve(mediaRequest(), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });
    expect(response.status).toBe(404);
  });

  test("public descriptor returns an immutable first-party URL", async () => {
    const objectKey = `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.png`;
    const harness = createHarness({ initial: [pendingRecord({
      status: "ready",
      visibility: "public",
      purpose: "product-image",
      targetId: STORE_ID,
      domain: "products",
      bucket: "public-media",
      objectKey,
      originalFileName: "camera.png",
      mimeType: "image/png",
    })] });
    const response = await harness.resolve(mediaRequest(), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.url).toBe(`https://media.lumapos.shop/${objectKey}`);
  });

  test("DELETE soft-deletes metadata and never removes storage synchronously", async () => {
    const harness = createHarness({ initial: [pendingRecord({ status: "ready" })] });
    const response = await harness.remove(mediaRequest(MEDIA_ID, "DELETE"), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { id: MEDIA_ID, status: "deleted" } });
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("deleted");
    expect(harness.storageState.removed).toEqual([]);
  });

  test("DELETE safely abandons an uncommitted pending upload", async () => {
    const harness = createHarness({ initial: [pendingRecord()] });
    const response = await harness.remove(mediaRequest(MEDIA_ID, "DELETE"), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(200);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("deleted");
    expect(harness.storageState.removed).toEqual([{
      bucket: "private-media",
      key: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.pdf`,
    }]);
  });

  test("DELETE preserves referenced evidence or signature media", async () => {
    const harness = createHarness({
      protectedDelete: true,
      initial: [pendingRecord({ status: "ready" })],
    });
    const response = await harness.remove(mediaRequest(MEDIA_ID, "DELETE"), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(409);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
    expect(harness.storageState.removed).toEqual([]);
  });

  test("DELETE fails closed if authorized target coordinates change before the row lock", async () => {
    const harness = createHarness({
      mutateTargetBeforeDelete: OTHER_MEDIA_ID,
      initial: [pendingRecord({ status: "ready" })],
    });
    const response = await harness.remove(mediaRequest(MEDIA_ID, "DELETE"), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });

    expect(response.status).toBe(409);
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe("ready");
    expect(harness.storageState.removed).toEqual([]);
  });
});

test("upload intent coordinates are durable and indexed without modifying migration 0110", () => {
  const migration = readFileSync("drizzle/0111_media_upload_intent_coordinates.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");

  expect(migration).toContain('ADD COLUMN "purpose" text');
  expect(migration).toContain('ADD COLUMN "target_id" uuid');
  expect(migration).toContain('ADD COLUMN "upload_expires_at" timestamptz');
  expect(migration).toContain('ALTER COLUMN "purpose" SET NOT NULL');
  expect(migration).toContain('ALTER COLUMN "target_id" SET NOT NULL');
  expect(migration).toContain('ALTER COLUMN "upload_expires_at" SET NOT NULL');
  expect(migration).toContain("ELSE 'project-document'");
  expect(migration).toContain('"status" = CASE WHEN "status" = \'deleted\'');
  expect(migration).toContain("'product-image','project-document','service-evidence','ai-attachment'");
  expect(migration).toContain('("store_id","purpose","target_id")');
  expect(migration).toContain('("status","upload_expires_at")');
  expect(schema).toContain('purpose: text("purpose")');
  expect(schema).toContain('targetId: uuid("target_id")');
  expect(schema).toContain('uploadExpiresAt: timestamp("upload_expires_at"');
});

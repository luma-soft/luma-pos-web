import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));

import type { MobileGate } from "../src/lib/mobile/auth";
import type { MediaRecord, MediaRepository } from "../src/lib/media/service";
import type { ObjectStorage } from "../src/lib/media/types";

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
const { createMediaTargetAuthorizer } = await import(
  "../src/lib/media/authorization"
);

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_MEDIA_ID = "55555555-5555-4555-8555-555555555555";
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
    ...overrides,
  };
}

function createHarness(options: {
  now?: Date;
  authorize?: "allowed" | "forbidden" | "not_found";
  initial?: MediaRecord[];
  protectedDelete?: boolean;
  objectBytes?: Uint8Array;
} = {}) {
  const records = new Map(
    (options.initial ?? []).map((record) => [`${record.storeId}:${record.id}`, record]),
  );
  const storageState = {
    heads: new Map<string, { sizeBytes: number; contentType: string | null; etag: string | null }>(),
    removed: [] as Array<{ bucket: string; key: string }>,
    puts: [] as Array<{ bucket: string; key: string; contentType: string; sizeBytes: number }>,
    downloads: 0,
  };

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
    async getForStore(input) {
      return records.get(`${input.storeId}:${input.mediaId}`) ?? null;
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
    async softDelete(input) {
      const key = `${input.storeId}:${input.mediaId}`;
      const current = records.get(key);
      if (!current || current.status !== "ready") return null;
      const deleted = {
        ...current,
        status: "deleted" as const,
        deletedAt: input.deletedAt,
      };
      records.set(key, deleted);
      return deleted;
    },
    async isDeletionProtected() {
      return options.protectedDelete ?? false;
    },
  };

  const storage: ObjectStorage = {
    async put(input) {
      storageState.puts.push({
        bucket: input.bucket,
        key: input.key,
        contentType: input.contentType,
        sizeBytes: input.body.byteLength,
      });
      return { sizeBytes: input.body.byteLength, contentType: input.contentType, etag: "thumb" };
    },
    async get() {
      storageState.downloads += 1;
      return options.objectBytes ?? new Uint8Array([1, 2, 3]);
    },
    async head(input) {
      return storageState.heads.get(`${input.bucket}:${input.key}`) ?? null;
    },
    async createUploadUrl(input) {
      return `https://r2.test/${input.bucket}/${input.key}?X-Amz-Expires=${input.expiresInSeconds}&X-Amz-Signature=upload`;
    },
    async createDownloadUrl(input) {
      return `https://r2.test/${input.bucket}/${input.key}?X-Amz-Expires=${input.expiresInSeconds}&X-Amz-Signature=download`;
    },
    async remove(input) {
      storageState.removed.push(input);
    },
    publicUrl(input) {
      return `https://media.lumapos.vn/${input.key}`;
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
    storageState,
    service,
    upload: createUploadIntentHandler({ authenticate, service }),
    complete: createCompleteUploadHandler({ authenticate, service }),
    resolve: createResolveMediaHandler({ authenticate, service }),
    remove: createDeleteMediaHandler({ authenticate, service }),
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
        headers: { "Content-Type": "application/pdf" },
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
      `https://media.lumapos.vn/stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/thumbnail.webp`,
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
        async technicianAssignedToJob(jobId, userId) {
          return state.jobAssignments.has(`${jobId}:${userId}`);
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
    state.jobAssignments.add(`${PROJECT_ID}:${USER_ID}`);
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
    expect((await response.json()).data.url).toBe(`https://media.lumapos.vn/${objectKey}`);
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
});

test("upload intent coordinates are durable and indexed without modifying migration 0110", () => {
  const migration = readFileSync("drizzle/0111_media_upload_intent_coordinates.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");

  expect(migration).toContain('ADD COLUMN "purpose" text NOT NULL');
  expect(migration).toContain('ADD COLUMN "target_id" uuid NOT NULL');
  expect(migration).toContain('ADD COLUMN "upload_expires_at" timestamptz NOT NULL');
  expect(migration).toContain("'product-image','project-document','service-evidence','ai-attachment'");
  expect(migration).toContain('("store_id","purpose","target_id")');
  expect(migration).toContain('("status","upload_expires_at")');
  expect(schema).toContain('purpose: text("purpose")');
  expect(schema).toContain('targetId: uuid("target_id")');
  expect(schema).toContain('uploadExpiresAt: timestamp("upload_expires_at"');
});

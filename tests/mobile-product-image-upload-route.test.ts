import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MediaActor } from "@/lib/media/authorization";
import type {
  MediaRecord,
  MediaRepository,
} from "@/lib/media/service";
import type { ObjectStorage } from "@/lib/media/types";

const legacyRemovals: string[][] = [];
let legacyClientCreations = 0;
mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));
mock.module("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient() {
    legacyClientCreations += 1;
    return {
      storage: {
        from() {
          return {
            async remove(paths: string[]) {
              legacyRemovals.push(paths);
              return { error: null };
            },
          };
        },
      },
    };
  },
}));
afterAll(() => mock.restore());

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_STORE_ID = "11111111-1111-4111-8111-111111111112";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_MEDIA_ID = "33333333-3333-4333-8333-333333333334";
const PATH = `stores/${STORE_ID}/products/2026/08/${MEDIA_ID}/original.jpg`;
const URL = `https://media.lumapos.vn/${PATH}`;
const NOW = new Date("2026-08-31T03:00:00.000Z");

const managedPuts: Array<{
  actor: Record<string, unknown>;
  input: Record<string, unknown>;
  bytes: Uint8Array;
}> = [];
const managedDeletes: string[] = [];
let heicConversions = 0;

const { uploadProductImage: uploadHandler, deleteProductImage: deleteHandler } =
  await import("../src/lib/images/product-image-route");
const { createMediaService, MediaServiceError } = await import(
  "../src/lib/media/service"
);

const dependencies = {
  authenticate: async () => ({
    ok: true as const,
    storeId: STORE_ID,
    userId: USER_ID,
    role: "manager" as const,
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
  }),
  mediaService: {
    async putManagedObject(
      actor: MediaActor,
      input: unknown,
      bytes: Uint8Array,
    ) {
      managedPuts.push({
        actor,
        input: input as Record<string, unknown>,
        bytes,
      });
      return { mediaId: MEDIA_ID, path: PATH, url: URL };
    },
    async deleteMedia(_actor: MediaActor, mediaId: string) {
      managedDeletes.push(mediaId);
      return { id: mediaId, status: "deleted" as const };
    },
    async deleteManagedProductImageByPath() {
      throw new MediaServiceError("errors.notFound", 404);
    },
  },
  async convertHeif() {
    heicConversions += 1;
    return Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  },
  legacyPublicBaseUrl: "https://project.supabase.co",
};

const uploadProductImage = (request: Request) =>
  uploadHandler(request, dependencies);
const deleteProductImage = (request: Request) =>
  deleteHandler(request, dependencies);

beforeEach(() => {
  managedPuts.splice(0);
  managedDeletes.splice(0);
  legacyRemovals.splice(0);
  legacyClientCreations = 0;
  heicConversions = 0;
});

function uploadRequest(bytes: number[], type = "image/jpeg") {
  const form = new FormData();
  const extension = type.split("/").at(-1) ?? "jpg";
  form.set("file", new File([Uint8Array.from(bytes)], `camera.${extension}`, { type }));
  return new Request("https://luma.test/api/mobile/products/images", {
    method: "POST",
    body: form,
  });
}

function createOldClientLifecycleHarness(options: { referenced?: boolean } = {}) {
  const records = new Map<string, MediaRecord>();
  const objects = new Map<
    string,
    { body: Uint8Array; contentType: string }
  >();
  const removed: Array<{ bucket: string; key: string }> = [];
  const softDeleteInputs: Array<Record<string, unknown>> = [];

  const repository: MediaRepository = {
    async createPending(input) {
      const record: MediaRecord = {
        ...input,
        status: "pending",
        createdBy: input.createdBy ?? null,
        createdAt: NOW,
        readyAt: null,
        verifiedAt: null,
        deletedAt: null,
        thumbnailObjectKey: null,
        thumbnailSizeBytes: null,
      };
      records.set(`${record.storeId}:${record.id}`, record);
      return record;
    },
    async getForStore(input) {
      return records.get(`${input.storeId}:${input.mediaId}`) ?? null;
    },
    async markReady(input) {
      const coordinate = `${input.storeId}:${input.mediaId}`;
      const current = records.get(coordinate);
      if (!current || current.status !== "pending") return null;
      const ready: MediaRecord = {
        ...current,
        status: "ready",
        sizeBytes: input.actualSizeBytes,
        readyAt: input.readyAt,
        verifiedAt: input.verifiedAt,
      };
      records.set(coordinate, ready);
      return ready;
    },
    async saveThumbnail(input) {
      const coordinate = `${input.storeId}:${input.mediaId}`;
      const current = records.get(coordinate);
      if (!current || current.status !== "ready") return null;
      const updated: MediaRecord = {
        ...current,
        thumbnailObjectKey: input.objectKey,
        thumbnailSizeBytes: input.sizeBytes,
      };
      records.set(coordinate, updated);
      return updated;
    },
    async abandonPending(input) {
      const coordinate = `${input.storeId}:${input.mediaId}`;
      const current = records.get(coordinate);
      if (
        !current
        || current.status !== "pending"
        || current.purpose !== input.expectedPurpose
        || current.targetId !== input.expectedTargetId
      ) return null;
      const deleted: MediaRecord = {
        ...current,
        status: "deleted",
        deletedAt: input.deletedAt,
      };
      records.set(coordinate, deleted);
      return deleted;
    },
    async recoverReadyAfterFailure(input) {
      const coordinate = `${input.storeId}:${input.mediaId}`;
      const current = records.get(coordinate);
      if (
        !current
        || current.status !== "ready"
        || current.purpose !== input.expectedPurpose
        || current.targetId !== input.expectedTargetId
        || current.objectKey !== input.expectedObjectKey
        || current.createdBy !== input.expectedCreatedBy
      ) return { outcome: "conflict" };
      if (options.referenced) return { outcome: "referenced" };
      const deleted: MediaRecord = {
        ...current,
        status: "deleted",
        deletedAt: input.recoveredAt,
      };
      records.set(coordinate, deleted);
      return { outcome: "deleted", media: deleted };
    },
    async softDeleteIfUnreferenced(input) {
      softDeleteInputs.push(input);
      if (options.referenced) return { outcome: "referenced" };
      const coordinate = `${input.storeId}:${input.mediaId}`;
      const current = records.get(coordinate);
      if (
        !current
        || current.status !== "ready"
        || current.purpose !== input.expectedPurpose
        || current.targetId !== input.expectedTargetId
      ) return { outcome: "conflict" };
      const deleted: MediaRecord = {
        ...current,
        status: "deleted",
        deletedAt: input.deletedAt,
      };
      records.set(coordinate, deleted);
      return { outcome: "deleted", media: deleted };
    },
  };

  const storage: ObjectStorage = {
    async put(input) {
      objects.set(`${input.bucket}:${input.key}`, {
        body: input.body,
        contentType: input.contentType,
      });
      return {
        sizeBytes: input.body.byteLength,
        contentType: input.contentType,
        etag: "old-client-upload",
      };
    },
    async get(input) {
      const object = objects.get(`${input.bucket}:${input.key}`);
      if (!object) throw new Error("missing test object");
      return object.body;
    },
    async head(input) {
      const object = objects.get(`${input.bucket}:${input.key}`);
      return object
        ? {
            sizeBytes: object.body.byteLength,
            contentType: object.contentType,
            etag: "old-client-upload",
          }
        : null;
    },
    async createUploadUrl() {
      throw new Error("old-client multipart upload must not create an intent");
    },
    async createDownloadUrl() {
      throw new Error("product images must not use signed downloads");
    },
    async remove(input) {
      removed.push(input);
      objects.delete(`${input.bucket}:${input.key}`);
    },
    publicUrl(input) {
      return `https://media.lumapos.vn/${input.key}`;
    },
  };

  const service = createMediaService({
    storage,
    repository,
    config: { publicBucket: "public-media", privateBucket: "private-media" },
    authorizeTarget: async () => "allowed",
    now: () => NOW,
    randomUUID: () => MEDIA_ID,
    logger: { error() {} },
  });

  return {
    records,
    removed,
    softDeleteInputs,
    dependencies: {
      authenticate: dependencies.authenticate,
      mediaService: service,
      convertHeif: dependencies.convertHeif,
      legacyPublicBaseUrl: dependencies.legacyPublicBaseUrl,
    },
  };
}

async function uploadFromOldClient(
  harness: ReturnType<typeof createOldClientLifecycleHarness>,
) {
  const response = await uploadHandler(
    uploadRequest([0xff, 0xd8, 0xff, 0x00]),
    harness.dependencies,
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  return { path: body.data.path as string };
}

function pathOnlyDeleteRequest(path: string) {
  return new Request(
    `https://luma.test/api/mobile/products/images?${new URLSearchParams({ path })}`,
    { method: "DELETE" },
  );
}

describe("POST /api/mobile/products/images", () => {
  test("writes validated bytes through MediaService and returns managed coordinates", async () => {
    const response = await uploadProductImage(
      uploadRequest([0xff, 0xd8, 0xff, 0x00]),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { mediaId: MEDIA_ID, url: URL, path: PATH },
    });
    expect(managedPuts).toHaveLength(1);
    expect(managedPuts[0]).toMatchObject({
      actor: { storeId: STORE_ID, userId: USER_ID },
      input: {
        purpose: "product-image",
        targetId: STORE_ID,
        fileName: "camera.jpeg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      },
    });
    expect(Array.from(managedPuts[0]!.bytes)).toEqual([0xff, 0xd8, 0xff, 0x00]);
  });

  test("keeps MIME sniffing and HEIF-to-JPEG conversion before managed storage", async () => {
    const mismatch = await uploadProductImage(
      uploadRequest([0x89, 0x50, 0x4e, 0x47], "image/jpeg"),
    );
    expect(mismatch.status).toBe(400);
    expect(managedPuts).toEqual([]);

    const heif = await uploadProductImage(uploadRequest(
      [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
      "image/heic",
    ));
    expect(heif.status).toBe(200);
    expect(heicConversions).toBe(1);
    expect(managedPuts[0]).toMatchObject({
      input: {
        fileName: "camera.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      },
    });
  });
});

describe("DELETE /api/mobile/products/images", () => {
  test("deletes by managed media ID without passing an R2 key to Supabase", async () => {
    const response = await deleteProductImage(new Request(
      `https://luma.test/api/mobile/products/images?mediaId=${MEDIA_ID}&path=${encodeURIComponent(PATH)}`,
      { method: "DELETE" },
    ));
    expect(response.status).toBe(200);
    expect(managedDeletes).toEqual([MEDIA_ID]);
    expect(legacyRemovals).toEqual([]);
    expect(legacyClientCreations).toBe(0);
  });

  test("accepts trusted legacy coordinates for deferred cleanup without deleting storage", async () => {
    for (const path of [
      `${USER_ID}/uncommitted.jpg`,
      `stores/${STORE_ID}/products/drafts/${USER_ID}/uncommitted.jpg`,
    ]) {
      const url = `https://project.supabase.co/storage/v1/object/public/products/${path}`;
      const response = await deleteProductImage(new Request(
        `https://luma.test/api/mobile/products/images?${new URLSearchParams({ path, url })}`,
        { method: "DELETE" },
      ));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        data: { path, status: "deferred" },
      });
    }
    expect(legacyRemovals).toEqual([]);
    expect(legacyClientCreations).toBe(0);
  });

  test("lets an old client discard its multipart upload by retaining only the managed path", async () => {
    const harness = createOldClientLifecycleHarness();
    const retained = await uploadFromOldClient(harness);

    const response = await deleteHandler(
      pathOnlyDeleteRequest(retained.path),
      harness.dependencies,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { mediaId: MEDIA_ID, status: "deleted" },
    });
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe(
      "deleted",
    );
    expect(harness.softDeleteInputs).toEqual([expect.objectContaining({
      storeId: STORE_ID,
      mediaId: MEDIA_ID,
      expectedPurpose: "product-image",
      expectedTargetId: STORE_ID,
    })]);
    expect(harness.removed).toEqual([]);
  });

  test("rejects non-exact managed path metadata without entering deletion", async () => {
    const cases: Array<{
      name: string;
      mutate?: (record: MediaRecord) => void;
      path?: string;
    }> = [
      {
        name: "foreign store path",
        path: PATH.replace(STORE_ID, FOREIGN_STORE_ID),
      },
      {
        name: "wrong purpose",
        mutate: (record) => { record.purpose = "project-document"; },
      },
      {
        name: "wrong domain",
        mutate: (record) => { record.domain = "projects"; },
      },
      {
        name: "wrong staging target",
        mutate: (record) => { record.targetId = OTHER_MEDIA_ID; },
      },
      {
        name: "wrong bucket",
        mutate: (record) => { record.bucket = "private-media"; },
      },
      {
        name: "wrong visibility",
        mutate: (record) => { record.visibility = "private"; },
      },
      {
        name: "wrong object key",
        mutate: (record) => {
          record.objectKey = PATH.replace("/2026/08/", "/2026/07/");
        },
      },
      {
        name: "MIME and extension mismatch",
        mutate: (record) => { record.mimeType = "image/png"; },
      },
      {
        name: "legacy provider row",
        mutate: (record) => { record.provider = "supabase"; },
      },
      {
        name: "different embedded media ID",
        path: PATH.replace(MEDIA_ID, OTHER_MEDIA_ID),
      },
    ];

    for (const candidate of cases) {
      const harness = createOldClientLifecycleHarness();
      const retained = await uploadFromOldClient(harness);
      const record = harness.records.get(`${STORE_ID}:${MEDIA_ID}`)!;
      candidate.mutate?.(record);

      const response = await deleteHandler(
        pathOnlyDeleteRequest(candidate.path ?? retained.path),
        harness.dependencies,
      );

      expect(response.status, candidate.name).toBe(403);
      expect(record.status, candidate.name).toBe("ready");
      expect(harness.softDeleteInputs, candidate.name).toEqual([]);
      expect(harness.removed, candidate.name).toEqual([]);
    }
  });

  test("rejects noncanonical managed paths without entering deletion", async () => {
    const harness = createOldClientLifecycleHarness();
    await uploadFromOldClient(harness);
    const noncanonical = [
      `/${PATH}`,
      PATH.replace("/products/", "/products//"),
      PATH.replace("/2026/08/", "/2026/8/"),
      PATH.toUpperCase(),
      PATH.replace("original.jpg", "original.jpeg"),
      `${PATH}/`,
    ];

    for (const path of noncanonical) {
      const response = await deleteHandler(
        pathOnlyDeleteRequest(path),
        harness.dependencies,
      );
      expect(response.status, path).toBe(403);
    }
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe(
      "ready",
    );
    expect(harness.softDeleteInputs).toEqual([]);
    expect(harness.removed).toEqual([]);
  });

  test("keeps a referenced old-client upload live and reports the conflict", async () => {
    const harness = createOldClientLifecycleHarness({ referenced: true });
    const retained = await uploadFromOldClient(harness);

    const response = await deleteHandler(
      pathOnlyDeleteRequest(retained.path),
      harness.dependencies,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: "media.referenced",
    });
    expect(harness.records.get(`${STORE_ID}:${MEDIA_ID}`)?.status).toBe(
      "ready",
    );
    expect(harness.softDeleteInputs).toHaveLength(1);
    expect(harness.removed).toEqual([]);
  });

  test("defers exact, canonical-equivalent, shared, and concurrently referenced legacy objects", async () => {
    const path = `${USER_ID}/shared.jpg`;
    const exactUrl =
      `https://project.supabase.co/storage/v1/object/public/products/${path}`;
    const equivalentUrls = [
      exactUrl,
      `https://PROJECT.SUPABASE.CO/storage/v1/object/public/products/${path}`,
      `https://project.supabase.co/storage/v1/object/public/products/%32${path.slice(1)}`,
    ];
    let referenceChecks = 0;
    const deferredDependencies = {
      ...dependencies,
      async isLegacyReferenced() {
        referenceChecks += 1;
        return true;
      },
      async removeLegacy(removedPath: string) {
        legacyRemovals.push([removedPath]);
      },
    };

    for (const url of equivalentUrls) {
      const response = await deleteHandler(new Request(
        `https://luma.test/api/mobile/products/images?${new URLSearchParams({ path, url })}`,
        { method: "DELETE" },
      ), deferredDependencies);

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        data: { path, status: "deferred" },
      });
    }
    expect(referenceChecks).toBe(0);
    expect(legacyRemovals).toEqual([]);
    expect(legacyClientCreations).toBe(0);
  });

  test("does not race a cross-store or newly inserted reference before cleanup", async () => {
    const path = `${USER_ID}/racy-shared.jpg`;
    const url =
      `https://project.supabase.co/storage/v1/object/public/products/${path}`;
    let insertedConcurrently = false;
    const racyDependencies = {
      ...dependencies,
      async isLegacyReferenced() {
        // Models another writer inserting a reference after a non-atomic
        // preflight check. Deferred cleanup performs no such check/delete pair.
        insertedConcurrently = true;
        return false;
      },
      async removeLegacy(removedPath: string) {
        legacyRemovals.push([removedPath]);
      },
    };
    const response = await deleteHandler(new Request(
      `https://luma.test/api/mobile/products/images?${new URLSearchParams({ path, url })}`,
      { method: "DELETE" },
    ), racyDependencies);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      data: { path, status: "deferred" },
    });
    expect(insertedConcurrently).toBe(false);
    expect(legacyRemovals).toEqual([]);
    expect(legacyClientCreations).toBe(0);
  });

  test("rejects a foreign host even when it supplies the same trusted bucket path", async () => {
    const path = `${USER_ID}/uncommitted.jpg`;
    const url = `https://attacker.test/storage/v1/object/public/products/${path}`;
    const response = await deleteProductImage(new Request(
      `https://luma.test/api/mobile/products/images?${new URLSearchParams({ path, url })}`,
      { method: "DELETE" },
    ));

    expect(response.status).toBe(403);
    expect(legacyRemovals).toEqual([]);
  });

  test("never accepts an untracked path-only R2 key or another user's legacy path", async () => {
    for (const path of [
      PATH.replace(MEDIA_ID, OTHER_MEDIA_ID),
      `${USER_ID}/path-only.jpg`,
      "someone-else/uncommitted.jpg",
      `stores/${STORE_ID}/products/drafts/someone-else/uncommitted.jpg`,
    ]) {
      const response = await deleteProductImage(new Request(
        `https://luma.test/api/mobile/products/images?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      ));
      expect(response.status).toBe(403);
    }
    expect(managedDeletes).toEqual([]);
    expect(legacyRemovals).toEqual([]);
  });
});

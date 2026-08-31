import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, isNull } from "drizzle-orm";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));

import type { MediaActor } from "../src/lib/media/authorization";
import type {
  MediaRecord,
  MediaRepository,
  MediaService,
} from "../src/lib/media/service";
import type {
  ProjectMediaInternalRecord,
  ProjectMediaRepository,
} from "../src/lib/media/project-media";
import type { ObjectStorage } from "../src/lib/media/types";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  brands,
  mediaObjects,
  profiles,
  projects,
  serviceAttachments,
  serviceHandoverDocumentMedia,
  serviceHandoverDocuments,
  serviceJobs,
  stores,
} = schema;
const {
  PROJECT_MEDIA_SIGNED_URL_SECONDS,
  ProjectMediaError,
  createDatabaseProjectMediaRepository,
  createProjectMediaManager,
  listProjectAttachmentSummaries,
  projectMediaUploadSchema,
  resolveManagedPrivateMediaUrl,
  sniffProjectMediaMime,
} = await import(`${projectRoot}/src/lib/media/project-media.ts`);
const { createMediaService } = await import(`${projectRoot}/src/lib/media/service.ts`);
const { createProjectAttachmentHandlers } = await import(
  `${projectRoot}/src/app/api/mobile/services/projects/[id]/attachments/route.ts`
);

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const STORE_B = "a1000000-0000-4000-8000-000000000001";
const USER_ID = "a1000000-0000-4000-8000-000000000002";
const PROJECT_ID = "a1000000-0000-4000-8000-000000000003";
const PROJECT_B = "a1000000-0000-4000-8000-000000000004";
const JOB_ID = "a1000000-0000-4000-8000-000000000005";
const DOCUMENT_ID = "a1000000-0000-4000-8000-000000000006";
const MEDIA_ID = "a1000000-0000-4000-8000-000000000007";
const OTHER_MEDIA_ID = "a1000000-0000-4000-8000-000000000008";
const ATTACHMENT_ID = "a1000000-0000-4000-8000-000000000009";
const BRAND_ID = "a1000000-0000-4000-8000-000000000010";
const NOW = new Date("2026-08-31T08:00:00.000Z");

const actor: MediaActor = {
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

function internalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    mediaId: MEDIA_ID,
    phase: "after_installation" as const,
    caption: "Mặt tiền sau lắp đặt",
    fileName: "site-after.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 4,
    createdAt: NOW,
    provider: "r2" as const,
    bucket: "lumapos-test-private-media",
    objectKey: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
    ...overrides,
  };
}

function testCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipContainer(entries: Array<string | {
  name: string;
  contents: string | Uint8Array;
  compress?: boolean;
}>) {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (target: number[], value: number) => {
    target.push(value & 0xff, (value >>> 8) & 0xff);
  };
  const u32 = (target: number[], value: number) => {
    target.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  };
  for (const entry of entries) {
    const entryName = typeof entry === "string" ? entry : entry.name;
    const contents = typeof entry === "string"
      ? new Uint8Array()
      : typeof entry.contents === "string"
        ? encoder.encode(entry.contents)
        : entry.contents;
    const compressed = typeof entry !== "string" && entry.compress
      ? new Uint8Array(deflateRawSync(contents))
      : contents;
    const method = typeof entry !== "string" && entry.compress ? 8 : 0;
    const name = [...encoder.encode(entryName)];
    const localOffset = local.length;
    const checksum = testCrc32(contents);
    u32(local, 0x04034b50);
    u16(local, 20);
    u16(local, 0);
    u16(local, method);
    u16(local, 0);
    u16(local, 0);
    u32(local, checksum);
    u32(local, compressed.length);
    u32(local, contents.length);
    u16(local, name.length);
    u16(local, 0);
    local.push(...name, ...compressed);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0);
    u16(central, method);
    u16(central, 0);
    u16(central, 0);
    u32(central, checksum);
    u32(central, compressed.length);
    u32(central, contents.length);
    u16(central, name.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, localOffset);
    central.push(...name);
  }
  const centralOffset = local.length;
  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0);
  u16(eocd, 0);
  u16(eocd, entries.length);
  u16(eocd, entries.length);
  u32(eocd, central.length);
  u32(eocd, centralOffset);
  u16(eocd, 0);
  return Uint8Array.from([...local, ...central, ...eocd]);
}

const WORD_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const WORD_ROOT_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function validWordEntries() {
  return [
    { name: "[Content_Types].xml", contents: WORD_CONTENT_TYPES },
    { name: "_rels/.rels", contents: WORD_ROOT_RELATIONSHIPS },
    {
      name: "word/document.xml",
      contents: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`,
    },
  ];
}

function fakeManagerHarness(options: {
  authorization?: "allowed" | "forbidden" | "not_found";
  associationFailure?: boolean;
  documentValidationFailure?: boolean;
  compensationFailure?: boolean;
  deleteOutcome?: "deleted" | "already_deleted" | "referenced" | "not_found" | "conflict";
} = {}) {
  const state = {
    listCalls: 0,
    uploadCalls: [] as unknown[],
    signCalls: [] as Array<{ mediaId: string; expiresInSeconds: number }>,
    documentValidationCalls: [] as unknown[],
    compensationCalls: [] as Array<{
      storeId: string;
      mediaId: string;
      purpose: string;
      targetId: string;
      expectedObjectKey: string;
      expectedCreatedBy: string | null;
    }>,
    deleteCalls: [] as unknown[],
  };
  const repository = {
    async listProjectAttachments() {
      state.listCalls += 1;
      return [internalRecord()];
    },
    async validateProjectDocument(input: unknown) {
      state.documentValidationCalls.push(input);
      if (options.documentValidationFailure) {
        throw new Error("PROJECT_MEDIA_DOCUMENT_NOT_FOUND");
      }
    },
    async createProjectAttachment(input: unknown) {
      if (options.associationFailure) throw new Error("association failed");
      return internalRecord({
        phase: (input as { phase: string }).phase,
        caption: (input as { caption: string | null }).caption,
      });
    },
    async deleteProjectAttachment(input: unknown) {
      state.deleteCalls.push(input);
      return { outcome: options.deleteOutcome ?? "deleted", id: ATTACHMENT_ID };
    },
  };
  const mediaService = {
    async putManagedObject(_actor: MediaActor, input: unknown, _bytes: Uint8Array) {
      void _actor;
      void _bytes;
      state.uploadCalls.push(input);
      return {
        mediaId: MEDIA_ID,
        path: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
        url: "https://r2.test/upload-result",
      };
    },
  } as Pick<MediaService, "putManagedObject">;
  const manager = createProjectMediaManager({
    authorizeProject: async () => options.authorization ?? "allowed",
    repository,
    mediaService,
    sign: async (record: ProjectMediaInternalRecord, expiresInSeconds: number) => {
      state.signCalls.push({ mediaId: record.mediaId, expiresInSeconds });
      return `https://r2.test/${record.objectKey}?X-Amz-Expires=${expiresInSeconds}`;
    },
    compensate: async (input: typeof state.compensationCalls[number]) => {
      state.compensationCalls.push(input);
      if (options.compensationFailure) {
        throw new Error("MANAGED_MEDIA_RECOVERY_CONFLICT");
      }
      return { outcome: "deleted" as const, media: { id: input.mediaId } };
    },
    logger: { error() {} },
  });
  return { manager, state };
}

describe("project media validation and orchestration", () => {
  test("accepts one controlled project phase and verifies the file signature", () => {
    expect(projectMediaUploadSchema.safeParse({
      phase: "after_installation",
      caption: "  Sau lắp đặt  ",
      documentId: DOCUMENT_ID,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    })).toMatchObject({
      success: true,
      data: { caption: "Sau lắp đặt" },
    });
    expect(sniffProjectMediaMime(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
      "site-after.jpg",
      "image/jpeg",
    )).toBe("image/jpeg");
  });

  test("rejects uncontrolled phases, malformed document ids, and disguised files", () => {
    expect(projectMediaUploadSchema.safeParse({
      phase: "post-install",
      documentId: DOCUMENT_ID,
      fileName: "payload.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    }).success).toBe(false);
    expect(projectMediaUploadSchema.safeParse({
      phase: "handover",
      documentId: "not-a-uuid",
      fileName: "payload.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    }).success).toBe(false);
    expect(projectMediaUploadSchema.safeParse({
      phase: "other",
      fileName: "oversized.pdf",
      mimeType: "application/pdf",
      sizeBytes: 25 * 1024 * 1024 + 1,
    }).success).toBe(false);
    expect(sniffProjectMediaMime(
      Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
      "payload.jpg",
      "image/jpeg",
    )).toBeNull();
    expect(sniffProjectMediaMime(
      Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "legacy.doc",
      "application/msword",
    )).toBeNull();
    expect(sniffProjectMediaMime(
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      "fake.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBeNull();
    expect(sniffProjectMediaMime(
      Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "renamed.xls",
      "application/vnd.ms-excel",
    )).toBeNull();
    expect(sniffProjectMediaMime(zipContainer([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/vbaProject.bin",
    ]), "macro.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBeNull();
  });

  test("accepts a structurally identified macro-free Open XML document", () => {
    expect(sniffProjectMediaMime(
      zipContainer(validWordEntries()),
      "handover.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ))
      .toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    expect(sniffProjectMediaMime(
      zipContainer(validWordEntries().map((entry) => ({ ...entry, compress: true }))),
      "compressed-handover.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    expect(sniffProjectMediaMime(zipContainer([
      ...validWordEntries(),
      {
        name: "word/_rels/document.xml.rels",
        contents: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://lumapos.vn/docs?a=1&amp;b=2" TargetMode="External"/></Relationships>`,
      },
    ]), "linked-handover.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  test("rejects malformed or active Open XML containers instead of trusting entry names", () => {
    expect(sniffProjectMediaMime(zipContainer(validWordEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? { ...entry, contents: "not XML" }
        : entry
    )), "invalid-main.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBeNull();

    const activeContentTypes = WORD_CONTENT_TYPES.replace(
      "</Types>",
      `<Override PartName="/word/custom.dat" ContentType="application/vnd.ms-office.vbaProject"/></Types>`,
    );
    expect(sniffProjectMediaMime(zipContainer([
      ...validWordEntries().filter((entry) => entry.name !== "[Content_Types].xml"),
      { name: "[Content_Types].xml", contents: activeContentTypes },
      { name: "word/custom.dat", contents: new Uint8Array([1, 2, 3]) },
    ]), "active.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBeNull();

    expect(sniffProjectMediaMime(zipContainer([
      ...validWordEntries(),
      {
        name: "word/_rels/document.xml.rels",
        contents: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://attacker.test/template.dotm" TargetMode="External"/></Relationships>`,
      },
    ]), "external.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBeNull();

    const webExtensionContentTypes = WORD_CONTENT_TYPES.replace(
      "</Types>",
      `<Override PartName="/webextensions/webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/></Types>`,
    );
    const webExtensionRelationships = WORD_ROOT_RELATIONSHIPS.replace(
      "</Relationships>",
      `<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="/webextensions/webextension1.xml"/></Relationships>`,
    );
    expect(sniffProjectMediaMime(zipContainer([
      ...validWordEntries().filter((entry) =>
        entry.name !== "[Content_Types].xml" && entry.name !== "_rels/.rels"
      ),
      { name: "[Content_Types].xml", contents: webExtensionContentTypes },
      { name: "_rels/.rels", contents: webExtensionRelationships },
      { name: "webextensions/webextension1.xml", contents: "<we:webextension/>" },
    ]), "web-add-in.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBeNull();

    const mismatchedHeaders = zipContainer(validWordEntries());
    mismatchedHeaders[8] = 8;
    expect(sniffProjectMediaMime(
      mismatchedHeaders,
      "mismatch.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBeNull();
  });

  test("rejects Open XML archives whose declared expansion exceeds the bounded work budget", () => {
    const contentTypes = WORD_CONTENT_TYPES.replace(
      "</Types>",
      `<Default Extension="dat" ContentType="application/octet-stream"/></Types>`,
    );
    expect(sniffProjectMediaMime(zipContainer([
      ...validWordEntries().filter((entry) => entry.name !== "[Content_Types].xml"),
      { name: "[Content_Types].xml", contents: contentTypes },
      {
        name: "word/media/large-a.dat",
        contents: new Uint8Array(17 * 1024 * 1024),
        compress: true,
      },
      {
        name: "word/media/large-b.dat",
        contents: new Uint8Array(17 * 1024 * 1024),
        compress: true,
      },
    ]), "expansion-bomb.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toBeNull();
  });

  test("lists project descriptors with a fresh fifteen-minute private signature", async () => {
    const { manager, state } = fakeManagerHarness();
    const result = await manager.list(actor, PROJECT_ID);

    expect(result).toEqual([{
      id: ATTACHMENT_ID,
      mediaId: MEDIA_ID,
      phase: "after_installation",
      caption: "Mặt tiền sau lắp đặt",
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      createdAt: NOW,
      signedUrl: expect.stringContaining("X-Amz-Expires=900"),
    }]);
    expect(PROJECT_MEDIA_SIGNED_URL_SECONDS).toBe(15 * 60);
    expect(state.signCalls).toEqual([{
      mediaId: MEDIA_ID,
      expiresInSeconds: 15 * 60,
    }]);
  });

  test("conceals an unauthorized or cross-store project before querying media", async () => {
    const { manager, state } = fakeManagerHarness({ authorization: "not_found" });
    await expect(manager.list(actor, PROJECT_B)).rejects.toMatchObject({
      error: "errors.notFound",
      status: 404,
    });
    expect(state.listCalls).toBe(0);
  });

  test("uploads private project media and compensates a failed association without physical deletion", async () => {
    const { manager, state } = fakeManagerHarness({ associationFailure: true });
    await expect(manager.upload(actor, PROJECT_ID, {
      phase: "acceptance",
      caption: null,
      documentId: DOCUMENT_ID,
      fileName: "acceptance.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "a".repeat(64),
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]))).rejects.toThrow(
      "association failed",
    );

    expect(state.uploadCalls).toEqual([{
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "acceptance.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    }]);
    expect(state.compensationCalls).toEqual([{
      storeId: STORE_ID,
      mediaId: MEDIA_ID,
      purpose: "project-document",
      targetId: PROJECT_ID,
      expectedObjectKey: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
      expectedCreatedBy: USER_ID,
    }]);
  });

  test("prevalidates a handover document before uploading while retaining transaction revalidation", async () => {
    const { manager, state } = fakeManagerHarness({
      documentValidationFailure: true,
    });
    await expect(manager.upload(actor, PROJECT_ID, {
      phase: "handover",
      caption: null,
      documentId: DOCUMENT_ID,
      fileName: "handover.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "a".repeat(64),
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]))).rejects.toThrow(
      "PROJECT_MEDIA_DOCUMENT_NOT_FOUND",
    );
    expect(state.documentValidationCalls).toEqual([{
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    }]);
    expect(state.uploadCalls).toHaveLength(0);
    expect(state.compensationCalls).toHaveLength(0);
  });

  test("propagates an unsafe association-recovery failure instead of hiding it", async () => {
    const { manager } = fakeManagerHarness({
      associationFailure: true,
      compensationFailure: true,
    });
    await expect(manager.upload(actor, PROJECT_ID, {
      phase: "other",
      caption: null,
      fileName: "failure.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "a".repeat(64),
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]))).rejects.toThrow(
      "MANAGED_MEDIA_RECOVERY_CONFLICT",
    );
  });

  test("writes a new dossier object to the private R2 project key before associating it", async () => {
    const records = new Map<string, MediaRecord>();
    const puts: Array<{ bucket: string; key: string; ifNoneMatch?: "*" }> = [];
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
        records.set(record.id, record);
        return record;
      },
      async getForStore(input) {
        return records.get(input.mediaId) ?? null;
      },
      async markReady(input) {
        const current = records.get(input.mediaId);
        if (!current || current.status !== "pending") return null;
        const ready: MediaRecord = {
          ...current,
          status: "ready",
          sizeBytes: input.actualSizeBytes,
          readyAt: input.readyAt,
          verifiedAt: input.verifiedAt,
        };
        records.set(ready.id, ready);
        return ready;
      },
      async saveThumbnail() {
        return null;
      },
      async abandonPending() {
        return null;
      },
      async recoverReadyAfterFailure() {
        return { outcome: "referenced" };
      },
      async softDeleteIfUnreferenced() {
        return { outcome: "referenced" };
      },
    };
    const heads = new Map<string, { sizeBytes: number; contentType: string; etag: string }>();
    const storage: ObjectStorage = {
      async put(input) {
        puts.push({ bucket: input.bucket, key: input.key, ifNoneMatch: input.ifNoneMatch });
        const head = {
          sizeBytes: input.body.byteLength,
          contentType: input.contentType,
          etag: "project-media",
        };
        heads.set(`${input.bucket}:${input.key}`, head);
        return head;
      },
      async get() {
        return Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
      },
      async head(input) {
        return heads.get(`${input.bucket}:${input.key}`) ?? null;
      },
      async createUploadUrl() {
        return "https://r2.test/upload";
      },
      async createDownloadUrl(input) {
        return `https://r2.test/${input.key}?X-Amz-Expires=${input.expiresInSeconds}`;
      },
      async remove() {},
      publicUrl(input) {
        return `https://r2.test/${input.key}`;
      },
    };
    const service = createMediaService({
      storage,
      repository,
      config: {
        publicBucket: "lumapos-test-public-media",
        privateBucket: "lumapos-test-private-media",
      },
      authorizeTarget: async () => "allowed",
      now: () => NOW,
      randomUUID: () => MEDIA_ID,
      logger: { error() {} },
    });
    let association: { expectedPath: string } | null = null;
    const manager = createProjectMediaManager({
      authorizeProject: async () => "allowed",
      repository: {
        async listProjectAttachments() {
          return [];
        },
        async validateProjectDocument() {},
        async createProjectAttachment(
          input: Parameters<ProjectMediaRepository["createProjectAttachment"]>[0],
        ) {
          association = { expectedPath: input.expectedPath };
          return internalRecord({
            phase: input.phase,
            caption: input.caption,
            objectKey: input.expectedPath,
          });
        },
        async deleteProjectAttachment() {
          return { outcome: "deleted", id: ATTACHMENT_ID };
        },
      },
      mediaService: service,
      sign: async (record: ProjectMediaInternalRecord, expiresInSeconds: number) =>
        `https://r2.test/${record.objectKey}?X-Amz-Expires=${expiresInSeconds}`,
      compensate: async () => ({ outcome: "referenced" }),
    });

    await manager.upload(actor, PROJECT_ID, {
      phase: "after_installation",
      caption: null,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "c".repeat(64),
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]));

    expect(puts[0]).toMatchObject({
      bucket: "lumapos-test-private-media",
      ifNoneMatch: "*",
      key: expect.stringContaining(`/projects/2026/08/${MEDIA_ID}/original.jpg`),
    });
    expect(association).toEqual({ expectedPath: puts[0].key });
  });

  test("rejects deletion when the selected project media remains referenced", async () => {
    const { manager } = fakeManagerHarness({ deleteOutcome: "referenced" });
    await expect(manager.delete(actor, PROJECT_ID, ATTACHMENT_ID)).rejects
      .toEqual(new ProjectMediaError("media.referenced", 409));
  });
});

describe("project attachment route contract", () => {
  test("accepts exactly one multipart file and preserves the descriptor response shape", async () => {
    const { manager, state } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });
    const form = new FormData();
    form.set("phase", "after_installation");
    form.set("caption", "Mặt tiền");
    form.set("file", new File([
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    ], "site-after.jpg", { type: "image/jpeg" }));

    const response = await handlers.POST(new Request("https://luma.test", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: ATTACHMENT_ID,
      mediaId: MEDIA_ID,
      phase: "after_installation",
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      signedUrl: "https://r2.test/upload-result",
    });
    expect(state.signCalls).toEqual([]);
  });

  test("rejects multiple files and malformed phase/document controls", async () => {
    const { manager, state } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });
    const form = new FormData();
    form.set("phase", "unsafe");
    form.set("documentId", "wrong");
    form.append("file", new File(["one"], "one.txt", { type: "text/plain" }));
    form.append("file", new File(["two"], "two.txt", { type: "text/plain" }));
    const response = await handlers.POST(new Request("https://luma.test", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(400);
    expect(state.uploadCalls).toEqual([]);
  });

  test("rejects an unexpected second file field instead of buffering an unbounded request", async () => {
    const { manager, state } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });
    const form = new FormData();
    form.set("phase", "handover");
    form.set("file", new File([
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    ], "handover.jpg", { type: "image/jpeg" }));
    form.set("unexpected", new File(["extra"], "extra.txt", { type: "text/plain" }));

    const response = await handlers.POST(new Request("https://luma.test", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(400);
    expect(state.uploadCalls).toEqual([]);
  });

  test("DELETE uses a validated selected attachment id and returns the legacy ok envelope", async () => {
    const { manager } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });
    const response = await handlers.DELETE(new Request(
      `https://luma.test?attachmentId=${ATTACHMENT_ID}`,
      { method: "DELETE" },
    ), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { id: ATTACHMENT_ID, status: "deleted" },
    });
  });
});

describe("project media database repository", () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  const repository = createDatabaseProjectMediaRepository(database);

  async function applySqlFile(path: string) {
    for (const statement of readFileSync(path, "utf8")
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (!/create extension|gin_trgm_ops/i.test(statement)) {
        await client.exec(statement);
      }
    }
  }

  beforeAll(async () => {
    for (const file of readdirSync(`${projectRoot}/drizzle`)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await applySqlFile(`${projectRoot}/drizzle/${file}`);
    }
    await database.insert(stores).values({ id: STORE_B, slug: "project-media-b" });
    await database.insert(profiles).values({
      id: USER_ID,
      storeId: STORE_ID,
      fullName: "Project Media Manager",
      role: "manager",
    });
    await database.insert(projects).values([
      { id: PROJECT_ID, storeId: STORE_ID, name: "Project media A", serviceType: "camera" },
      { id: PROJECT_B, storeId: STORE_B, name: "Project media B", serviceType: "camera" },
    ]);
    await database.insert(serviceJobs).values({
      id: JOB_ID,
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      code: "MEDIA-JOB",
      serviceType: "camera",
      title: "Job attachment exclusion",
    });
    await database.insert(serviceHandoverDocuments).values({
      id: DOCUMENT_ID,
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      type: "handover",
      title: "Handover",
    });
    await database.insert(mediaObjects).values([
      {
        id: MEDIA_ID,
        storeId: STORE_ID,
        provider: "r2",
        visibility: "private",
        purpose: "project-document",
        targetId: PROJECT_ID,
        domain: "projects",
        bucket: "lumapos-test-private-media",
        objectKey: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
        originalFileName: "site-after.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        status: "ready",
        uploadExpiresAt: new Date(NOW.getTime() + 600_000),
        readyAt: NOW,
      },
      {
        id: OTHER_MEDIA_ID,
        storeId: STORE_ID,
        provider: "r2",
        visibility: "private",
        purpose: "service-evidence",
        targetId: JOB_ID,
        domain: "service-evidence",
        bucket: "lumapos-test-private-media",
        objectKey: `stores/${STORE_ID}/service-evidence/2026/08/${OTHER_MEDIA_ID}/original.jpg`,
        originalFileName: "job.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        status: "ready",
        uploadExpiresAt: new Date(NOW.getTime() + 600_000),
        readyAt: NOW,
      },
    ]);
    await database.insert(serviceAttachments).values([
      {
        id: ATTACHMENT_ID,
        storeId: STORE_ID,
        projectId: PROJECT_ID,
        mediaObjectId: MEDIA_ID,
        projectPhase: "after_installation",
        category: "after",
        bucket: "lumapos-test-private-media",
        path: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
        fileName: "site-after.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      },
      {
        storeId: STORE_ID,
        projectId: PROJECT_ID,
        jobId: JOB_ID,
        mediaObjectId: OTHER_MEDIA_ID,
        category: "after",
        bucket: "lumapos-test-private-media",
        path: `stores/${STORE_ID}/service-evidence/2026/08/${OTHER_MEDIA_ID}/original.jpg`,
        fileName: "job.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
      },
    ]);
    await database.insert(serviceHandoverDocumentMedia).values({
      storeId: STORE_ID,
      documentId: DOCUMENT_ID,
      mediaObjectId: MEDIA_ID,
      sortOrder: 0,
    });
  });

  afterAll(async () => client.close());

  test("lists only active project-level rows and excludes job/claim/asset/request media", async () => {
    expect(await repository.listProjectAttachments({
      storeId: STORE_ID,
      projectId: PROJECT_ID,
    })).toEqual([expect.objectContaining({
      id: ATTACHMENT_ID,
      mediaId: MEDIA_ID,
      provider: "r2",
      bucket: "lumapos-test-private-media",
    })]);
  });

  test("returns project-detail summaries without persisted or embedded private URLs", async () => {
    expect(await listProjectAttachmentSummaries(database, {
      storeId: STORE_ID,
      projectId: PROJECT_ID,
    })).toEqual([{
      id: ATTACHMENT_ID,
      mediaId: MEDIA_ID,
      phase: "after_installation",
      caption: null,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      createdAt: expect.any(Date),
      documentIds: [DOCUMENT_ID],
    }]);
  });

  test("routes canonical private signing through the row provider for fifteen minutes", async () => {
    const providers: string[] = [];
    const url = await resolveManagedPrivateMediaUrl(actor, MEDIA_ID, {
      database,
      authorizeTarget: async () => "allowed",
      storageForProvider: (provider: string) => {
        providers.push(provider);
        return {
          async createDownloadUrl(input: { key: string; expiresInSeconds: number }) {
            return `https://${provider}.test/${input.key}?expires=${input.expiresInSeconds}`;
          },
        };
      },
    });
    expect(providers).toEqual(["r2"]);
    expect(url).toContain("expires=900");
  });

  test("rejects a document from another project/store transactionally", async () => {
    await expect(repository.createProjectAttachment({
      storeId: STORE_B,
      actorId: USER_ID,
      projectId: PROJECT_B,
      mediaId: MEDIA_ID,
      expectedPath: `stores/${STORE_ID}/projects/2026/08/${MEDIA_ID}/original.jpg`,
      phase: "handover",
      caption: null,
      documentId: DOCUMENT_ID,
      fileName: "wrong.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "b".repeat(64),
      createdAt: NOW,
    })).rejects.toMatchObject({ code: "PROJECT_MEDIA_DOCUMENT_NOT_FOUND" });
    expect(await database.select().from(serviceAttachments).where(and(
      eq(serviceAttachments.storeId, STORE_B),
      eq(serviceAttachments.projectId, PROJECT_B),
    ))).toHaveLength(0);
  });

  test("rolls the attachment and document detachments back when another live reference exists", async () => {
    await database.insert(brands).values({
      id: BRAND_ID,
      storeId: STORE_ID,
      name: "Reference guard",
      logoMediaObjectId: MEDIA_ID,
    });
    expect(await repository.deleteProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      attachmentId: ATTACHMENT_ID,
      deletedAt: new Date(NOW.getTime() + 500),
    })).toEqual({ outcome: "referenced" });
    const [attachment] = await database.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, ATTACHMENT_ID));
    const [media] = await database.select().from(mediaObjects)
      .where(eq(mediaObjects.id, MEDIA_ID));
    expect(attachment.deletedAt).toBeNull();
    expect(media.status).toBe("ready");
    expect(await database.select().from(serviceHandoverDocumentMedia)
      .where(eq(serviceHandoverDocumentMedia.mediaObjectId, MEDIA_ID)))
      .toHaveLength(1);
    await database.delete(brands).where(eq(brands.id, BRAND_ID));
  });

  test("removes the explicit document association and soft-deletes media atomically", async () => {
    expect(await repository.deleteProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      attachmentId: ATTACHMENT_ID,
      deletedAt: new Date(NOW.getTime() + 1_000),
    })).toEqual({
      outcome: "deleted",
      id: ATTACHMENT_ID,
    });
    const [attachment] = await database.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, ATTACHMENT_ID));
    const [media] = await database.select().from(mediaObjects)
      .where(eq(mediaObjects.id, MEDIA_ID));
    expect(attachment.deletedAt).toBeInstanceOf(Date);
    expect(media.status).toBe("deleted");
    expect(await database.select().from(serviceHandoverDocumentMedia)
      .where(eq(serviceHandoverDocumentMedia.mediaObjectId, MEDIA_ID)))
      .toHaveLength(0);
  });

  test("repeated DELETE is idempotent and a job attachment id is concealed", async () => {
    expect(await repository.deleteProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      attachmentId: ATTACHMENT_ID,
      deletedAt: new Date(NOW.getTime() + 2_000),
    })).toEqual({ outcome: "already_deleted", id: ATTACHMENT_ID });

    const [jobAttachment] = await database.select({ id: serviceAttachments.id })
      .from(serviceAttachments).where(and(
        eq(serviceAttachments.jobId, JOB_ID),
        isNull(serviceAttachments.deletedAt),
      ));
    expect(await repository.deleteProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      attachmentId: jobAttachment.id,
      deletedAt: new Date(NOW.getTime() + 2_000),
    })).toEqual({ outcome: "not_found" });
  });
});

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray, isNull } from "drizzle-orm";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({ db: {} }));

import type { MediaActor } from "../src/lib/media/authorization";
import type {
  MediaRecord,
  MediaRepository,
  MediaService,
  ReservedMediaUploadLock,
} from "../src/lib/media/service";
import type {
  ProjectMediaInternalRecord,
  ProjectMediaRepository,
} from "../src/lib/media/project-media";
import {
  ObjectStorageWriteError,
  type ObjectStorage,
} from "../src/lib/media/types";

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
  compensateManagedMediaAssociation,
  cleanupTerminalProjectAttachmentReservation,
  listProjectAttachmentSummaries,
  projectMediaUploadSchema,
  resolveManagedPrivateMediaUrl,
  sniffProjectMediaMime,
} = await import(`${projectRoot}/src/lib/media/project-media.ts`);
const { createMediaService } = await import(`${projectRoot}/src/lib/media/service.ts`);
const { createDatabaseMediaRepository } = await import(
  `${projectRoot}/src/lib/media/repository.ts`
);
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
const IDEMPOTENCY_ID = "a1000000-0000-4000-8000-000000000011";
const RESERVATION_ID = "a1000000-0000-4000-8000-000000000014";
const PROJECT_UPLOAD_ID = "a1000000-0000-4000-8000-000000000015";
const AMBIGUOUS_UPLOAD_ID = "a1000000-0000-4000-8000-000000000016";
const DUPLICATE_UPLOAD_ID = "a1000000-0000-4000-8000-000000000017";
const AMBIGUOUS_BEFORE_ID = "a1000000-0000-4000-8000-000000000018";
const CONCURRENT_UPLOAD_ID = "a1000000-0000-4000-8000-000000000019";
const CHANGED_UPLOAD_ID = "a1000000-0000-4000-8000-000000000020";
const CROSS_STORE_RESERVATION_ID = "a1000000-0000-4000-8000-000000000021";
const CROSS_PURPOSE_RESERVATION_ID = "a1000000-0000-4000-8000-000000000022";
const CROSS_TARGET_RESERVATION_ID = "a1000000-0000-4000-8000-000000000023";
const TERMINAL_RESERVATION_ID = "a1000000-0000-4000-8000-000000000024";
const TERMINAL_RACE_ID = "a1000000-0000-4000-8000-000000000025";
const EXPIRED_EMPTY_RESERVATION_ID = "a1000000-0000-4000-8000-000000000026";
const EXPIRED_MISMATCH_RESERVATION_ID = "a1000000-0000-4000-8000-000000000027";
const EXPIRY_FENCE_RESERVATION_ID = "a1000000-0000-4000-8000-000000000028";
const HUNG_EXACT_RESERVATION_ID = "a1000000-0000-4000-8000-000000000029";
const HUNG_MISSING_RESERVATION_ID = "a1000000-0000-4000-8000-000000000030";
const HUNG_MISMATCH_RESERVATION_ID = "a1000000-0000-4000-8000-000000000031";
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
    signCalls: [] as Array<{
      mediaId: string;
      expiresInSeconds: number;
      downloadFileName?: string;
    }>,
    getAttachmentCalls: [] as unknown[],
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
  let idempotentRecord: ProjectMediaInternalRecord | null = null;
  let idempotentSha256: string | null = null;
  const repository = {
    async listProjectAttachments() {
      state.listCalls += 1;
      return [internalRecord()];
    },
    async getProjectAttachment(input: { attachmentId: string }) {
      state.getAttachmentCalls.push(input);
      if (input.attachmentId === ATTACHMENT_ID) {
        return { record: internalRecord(), documentIds: [], sha256: "a".repeat(64) };
      }
      if (idempotentRecord?.id === input.attachmentId) {
        return { record: idempotentRecord, documentIds: [], sha256: idempotentSha256 };
      }
      return null;
    },
    async validateProjectDocument(input: unknown) {
      state.documentValidationCalls.push(input);
      if (options.documentValidationFailure) {
        throw new Error("PROJECT_MEDIA_DOCUMENT_NOT_FOUND");
      }
    },
    async reserveProjectAttachment(input: unknown) {
      const candidate = input as {
        idempotencyKey: string;
        mediaId: string;
        phase: ProjectMediaInternalRecord["phase"];
        caption: string | null;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        expectedPath: string;
        documentId?: string;
        sha256: string;
      };
      return {
        record: internalRecord({
          id: candidate.idempotencyKey,
          mediaId: candidate.mediaId,
          phase: candidate.phase,
          caption: candidate.caption,
          fileName: candidate.fileName,
          mimeType: candidate.mimeType,
          sizeBytes: candidate.sizeBytes,
          objectKey: candidate.expectedPath,
        }),
        documentIds: candidate.documentId ? [candidate.documentId] : [],
        sha256: candidate.sha256,
        mediaStatus: "pending" as const,
      };
    },
    async createProjectAttachment(input: unknown) {
      if (options.associationFailure) throw new Error("association failed");
      idempotentRecord = internalRecord({
        id: (input as { idempotencyKey?: string }).idempotencyKey ?? ATTACHMENT_ID,
        mediaId: (input as { mediaId: string }).mediaId,
        phase: (input as { phase: string }).phase,
        caption: (input as { caption: string | null }).caption,
        fileName: (input as { fileName: string }).fileName,
        mimeType: (input as { mimeType: string }).mimeType,
        sizeBytes: (input as { sizeBytes: number }).sizeBytes,
        objectKey: (input as { expectedPath: string }).expectedPath,
      });
      idempotentSha256 = (input as { sha256: string }).sha256;
      return idempotentRecord;
    },
    async deleteProjectAttachment(input: unknown) {
      state.deleteCalls.push(input);
      return { outcome: options.deleteOutcome ?? "deleted", id: ATTACHMENT_ID };
    },
  };
  const reservations = new Map<string, { path: string }>();
  const mediaService = {
    async reserveManagedObject(_actor: MediaActor, input: unknown) {
      void _actor;
      const candidate = input as {
        reservationId: string;
        purpose: string;
        targetId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      };
      state.uploadCalls.push({
        purpose: candidate.purpose,
        targetId: candidate.targetId,
        fileName: candidate.fileName,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
      });
      const path = `stores/${STORE_ID}/projects/2026/08/${candidate.reservationId}/original.jpg`;
      const created = !reservations.has(candidate.reservationId);
      reservations.set(candidate.reservationId, { path });
      return {
        mediaId: candidate.reservationId,
        path,
        status: "pending" as const,
        created,
      };
    },
    async putReservedManagedObject(
      _actor: MediaActor,
      mediaId: string,
      _bytes: Uint8Array,
    ) {
      void _actor;
      void _bytes;
      const path = reservations.get(mediaId)?.path
        ?? `stores/${STORE_ID}/projects/2026/08/${mediaId}/original.jpg`;
      return {
        mediaId,
        path,
        url: "https://r2.test/upload-result",
      };
    },
  } as Pick<MediaService, "reserveManagedObject" | "putReservedManagedObject">;
  const manager = createProjectMediaManager({
    authorizeProject: async () => options.authorization ?? "allowed",
    repository,
    mediaService,
    sign: async (
      record: ProjectMediaInternalRecord,
      expiresInSeconds: number,
      options?: { downloadFileName?: string },
    ) => {
      state.signCalls.push({
        mediaId: record.mediaId,
        expiresInSeconds,
        ...(options?.downloadFileName
          ? { downloadFileName: options.downloadFileName }
          : {}),
      });
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
      idempotencyKey: IDEMPOTENCY_ID,
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

  test("requires a client idempotency key before accepting an upload", () => {
    expect(projectMediaUploadSchema.safeParse({
      phase: "after_installation",
      caption: null,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    }).success).toBe(false);
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

  test("replays an upload idempotently by client attachment id without writing a second object", async () => {
    const { manager, state } = fakeManagerHarness();
    const upload = () => manager.upload(actor, PROJECT_ID, {
      phase: "after_installation",
      caption: "Mặt tiền",
      fileName: "retry-safe.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      idempotencyKey: IDEMPOTENCY_ID,
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]));

    const first = await upload();
    const replay = await upload();

    expect(first.id).toBe(IDEMPOTENCY_ID);
    expect(replay.id).toBe(IDEMPOTENCY_ID);
    expect(state.uploadCalls).toHaveLength(1);
    expect(state.getAttachmentCalls).toEqual([
      { storeId: STORE_ID, projectId: PROJECT_ID, attachmentId: IDEMPOTENCY_ID },
      { storeId: STORE_ID, projectId: PROJECT_ID, attachmentId: IDEMPOTENCY_ID },
    ]);
  });

  test("rejects an idempotency key reused with a different upload payload", async () => {
    const { manager, state } = fakeManagerHarness();
    const base = {
      phase: "after_installation" as const,
      caption: "Mặt tiền",
      fileName: "retry-safe.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      idempotencyKey: IDEMPOTENCY_ID,
    };
    await manager.upload(
      actor,
      PROJECT_ID,
      base,
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    );

    await expect(manager.upload(
      actor,
      PROJECT_ID,
      { ...base, caption: "Payload changed" },
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    )).rejects.toMatchObject({ status: 409 });
    expect(state.uploadCalls).toHaveLength(1);
  });

  test("concurrent idempotent uploads converge on one reserved media id", async () => {
    let winner: ProjectMediaInternalRecord | null = null;
    let createCount = 0;
    let releaseCreates: () => void = () => {};
    const bothCreating = new Promise<void>((resolve) => { releaseCreates = resolve; });
    const compensated: string[] = [];
    const manager = createProjectMediaManager({
      authorizeProject: async () => "allowed",
      repository: {
        async listProjectAttachments() { return []; },
        async getProjectAttachment() { return null; },
        async validateProjectDocument() {},
        async reserveProjectAttachment(
          input: Parameters<ProjectMediaRepository["reserveProjectAttachment"]>[0],
        ) {
          return {
            record: internalRecord({
              id: input.idempotencyKey,
              mediaId: input.mediaId,
              objectKey: input.expectedPath,
            }),
            documentIds: [],
            sha256: input.sha256,
            mediaStatus: "pending" as const,
          };
        },
        async createProjectAttachment(
          input: Parameters<ProjectMediaRepository["createProjectAttachment"]>[0],
        ) {
          createCount += 1;
          if (createCount === 2) releaseCreates();
          await bothCreating;
          winner ??= internalRecord({
            id: input.idempotencyKey,
            mediaId: input.mediaId,
            phase: input.phase,
            caption: input.caption,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            objectKey: input.expectedPath,
          });
          return winner;
        },
        async deleteProjectAttachment() {
          return { outcome: "deleted", id: IDEMPOTENCY_ID };
        },
      },
      mediaService: {
        async reserveManagedObject(_actor: MediaActor, value: unknown) {
          const mediaId = (value as { reservationId: string }).reservationId;
          return {
            mediaId,
            path: `stores/${STORE_ID}/projects/2026/08/${mediaId}/original.jpg`,
            status: "pending" as const,
            created: createCount === 0,
          };
        },
        async putReservedManagedObject(_actor: MediaActor, mediaId: string) {
          return {
            mediaId,
            path: `stores/${STORE_ID}/projects/2026/08/${mediaId}/original.jpg`,
            url: `https://r2.test/${mediaId}`,
          };
        },
      },
      sign: async (record: ProjectMediaInternalRecord) => `https://r2.test/signed/${record.mediaId}`,
      compensate: async (input: { mediaId: string }) => {
        compensated.push(input.mediaId);
        return { outcome: "deleted", media: { id: input.mediaId } } as const;
      },
    });
    const input = {
      phase: "after_installation" as const,
      caption: null,
      fileName: "concurrent.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "c".repeat(64),
      idempotencyKey: IDEMPOTENCY_ID,
    };

    const results = await Promise.all([
      manager.upload(actor, PROJECT_ID, input, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])),
      manager.upload(actor, PROJECT_ID, input, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])),
    ]);

    expect(results.map((result) => result.id)).toEqual([
      IDEMPOTENCY_ID,
      IDEMPOTENCY_ID,
    ]);
    expect(results.map((result) => result.mediaId)).toEqual([
      IDEMPOTENCY_ID,
      IDEMPOTENCY_ID,
    ]);
    expect(compensated).toHaveLength(0);
  });

  test("creates an attachment-disposition signature for a fresh authorized download", async () => {
    const { manager, state } = fakeManagerHarness();

    const result = await manager.download(actor, PROJECT_ID, ATTACHMENT_ID);
    const repeated = await manager.download(actor, PROJECT_ID, ATTACHMENT_ID);

    expect(result).toEqual({
      fileName: "site-after.jpg",
      url: expect.stringContaining("X-Amz-Expires=900"),
    });
    expect(repeated.fileName).toBe("site-after.jpg");
    expect(state.signCalls).toEqual([
      {
        mediaId: MEDIA_ID,
        expiresInSeconds: 15 * 60,
        downloadFileName: "site-after.jpg",
      },
      {
        mediaId: MEDIA_ID,
        expiresInSeconds: 15 * 60,
        downloadFileName: "site-after.jpg",
      },
    ]);
  });

  test("conceals an unauthorized download before looking up the attachment", async () => {
    const { manager, state } = fakeManagerHarness({ authorization: "not_found" });

    await expect(manager.download(actor, PROJECT_B, ATTACHMENT_ID)).rejects
      .toMatchObject({ error: "errors.notFound", status: 404 });
    expect(state.getAttachmentCalls).toEqual([]);
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
      idempotencyKey: IDEMPOTENCY_ID,
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
      mediaId: IDEMPOTENCY_ID,
      purpose: "project-document",
      targetId: PROJECT_ID,
      expectedObjectKey: `stores/${STORE_ID}/projects/2026/08/${IDEMPOTENCY_ID}/original.jpg`,
      expectedCreatedBy: USER_ID,
    }]);
  });

  test("canonicalizes UUID project, actor, and document coordinates before recovery", async () => {
    const { manager, state } = fakeManagerHarness({ associationFailure: true });
    const uppercaseActor = {
      ...actor,
      userId: USER_ID.toUpperCase(),
    };
    await expect(manager.upload(uppercaseActor, PROJECT_ID.toUpperCase(), {
      phase: "handover",
      caption: null,
      documentId: DOCUMENT_ID.toUpperCase(),
      fileName: "uuid-case.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "d".repeat(64),
      idempotencyKey: IDEMPOTENCY_ID.toUpperCase(),
    }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]))).rejects.toThrow(
      "association failed",
    );

    expect(state.documentValidationCalls).toEqual([{
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    }]);
    expect(state.uploadCalls).toEqual([{
      purpose: "project-document",
      targetId: PROJECT_ID,
      fileName: "uuid-case.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
    }]);
    expect(state.compensationCalls).toEqual([{
      storeId: STORE_ID,
      mediaId: IDEMPOTENCY_ID,
      purpose: "project-document",
      targetId: PROJECT_ID,
      expectedObjectKey: `stores/${STORE_ID}/projects/2026/08/${IDEMPOTENCY_ID}/original.jpg`,
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
      idempotencyKey: IDEMPOTENCY_ID,
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
      idempotencyKey: IDEMPOTENCY_ID,
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
          sha256: input.sha256 ?? null,
        };
        records.set(record.id, record);
        return record;
      },
      async reservePending(input) {
        const existing = records.get(input.id);
        if (existing) return { media: existing, created: false };
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
          sha256: input.sha256 ?? null,
        };
        records.set(record.id, record);
        return { media: record, created: true };
      },
      async getForStore(input) {
        return records.get(input.mediaId) ?? null;
      },
      async withReservedUploadLock(input, operation) {
        const current = records.get(input.mediaId);
        if (!current) return null;
        return operation({
          media: current,
          async markReady(value) {
            const pending = records.get(value.mediaId);
            if (!pending || pending.status !== "pending") return null;
            const ready: MediaRecord = {
              ...pending,
              status: "ready",
              sizeBytes: value.actualSizeBytes,
              readyAt: value.readyAt,
              verifiedAt: value.verifiedAt,
            };
            records.set(ready.id, ready);
            return ready;
          },
          async abandonPending() { return null; },
          async quarantinePending() { return null; },
        });
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
      async quarantinePending() {
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
        async getProjectAttachment() {
          return null;
        },
        async validateProjectDocument() {},
        async reserveProjectAttachment(
          input: Parameters<ProjectMediaRepository["reserveProjectAttachment"]>[0],
        ) {
          return {
            record: internalRecord({
              id: input.idempotencyKey,
              mediaId: input.mediaId,
              objectKey: input.expectedPath,
            }),
            documentIds: [],
            sha256: input.sha256,
            mediaStatus: "pending" as const,
          };
        },
        async createProjectAttachment(
          input: Parameters<ProjectMediaRepository["createProjectAttachment"]>[0],
        ) {
          association = { expectedPath: input.expectedPath };
          return internalRecord({
            id: input.idempotencyKey,
            mediaId: input.mediaId,
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

    const body = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    await manager.upload(actor, PROJECT_ID, {
      phase: "after_installation",
      caption: null,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: createHash("sha256").update(body).digest("hex"),
      idempotencyKey: IDEMPOTENCY_ID,
    }, body);

    expect(puts[0]).toMatchObject({
      bucket: "lumapos-test-private-media",
      ifNoneMatch: "*",
      key: expect.stringContaining(`/projects/2026/08/${IDEMPOTENCY_ID}/original.jpg`),
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
    form.set("idempotencyKey", IDEMPOTENCY_ID);
    form.set("file", new File([
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    ], "site-after.jpg", { type: "image/jpeg" }));

    const response = await handlers.POST(new Request("https://luma.test", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: IDEMPOTENCY_ID,
      mediaId: IDEMPOTENCY_ID,
      phase: "after_installation",
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      signedUrl: "https://r2.test/upload-result",
    });
    expect(state.signCalls).toEqual([]);
    expect(state.getAttachmentCalls).toEqual([{
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      attachmentId: IDEMPOTENCY_ID,
    }]);
  });

  test("rejects a multipart upload without an idempotency key", async () => {
    const { manager, state } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });
    const form = new FormData();
    form.set("phase", "after_installation");
    form.set("file", new File([
      Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    ], "site-after.jpg", { type: "image/jpeg" }));

    const response = await handlers.POST(new Request("https://luma.test", {
      method: "POST",
      body: form,
    }), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(400);
    expect(state.uploadCalls).toEqual([]);
  });

  test("redirects an authorized download through a fresh disposition-aware signature", async () => {
    const { manager } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });

    const response = await handlers.GET(new Request(
      `https://luma.test/api/mobile/services/projects/${PROJECT_ID}/attachments?attachmentId=${ATTACHMENT_ID}&download=1`,
    ), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("X-Amz-Expires=900");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("rejects a malformed download attachment id before repository lookup", async () => {
    const { manager, state } = fakeManagerHarness();
    const handlers = createProjectAttachmentHandlers({
      authenticate: async () => ({ ok: true, ...actor }),
      manager,
    });

    const response = await handlers.GET(new Request(
      `https://luma.test/api/mobile/services/projects/${PROJECT_ID}/attachments?attachmentId=not-a-uuid&download=1`,
    ), { params: Promise.resolve({ id: PROJECT_ID }) });

    expect(response.status).toBe(400);
    expect(state.getAttachmentCalls).toEqual([]);
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
        sha256: "c".repeat(64),
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

  afterEach(async () => {
    const taskIds = [
      RESERVATION_ID,
      PROJECT_UPLOAD_ID,
      AMBIGUOUS_UPLOAD_ID,
      DUPLICATE_UPLOAD_ID,
      AMBIGUOUS_BEFORE_ID,
      CONCURRENT_UPLOAD_ID,
      CHANGED_UPLOAD_ID,
      CROSS_STORE_RESERVATION_ID,
      CROSS_PURPOSE_RESERVATION_ID,
      CROSS_TARGET_RESERVATION_ID,
      TERMINAL_RESERVATION_ID,
      TERMINAL_RACE_ID,
      EXPIRED_EMPTY_RESERVATION_ID,
      EXPIRED_MISMATCH_RESERVATION_ID,
      EXPIRY_FENCE_RESERVATION_ID,
      HUNG_EXACT_RESERVATION_ID,
      HUNG_MISSING_RESERVATION_ID,
      HUNG_MISMATCH_RESERVATION_ID,
    ];
    await database.delete(serviceHandoverDocumentMedia).where(inArray(
      serviceHandoverDocumentMedia.mediaObjectId,
      taskIds,
    ));
    await database.delete(serviceAttachments).where(inArray(
      serviceAttachments.id,
      taskIds,
    ));
    await database.delete(mediaObjects).where(inArray(mediaObjects.id, taskIds));
  });

  function databaseBackedManager(
    storage: ObjectStorage,
    projectRepository: ProjectMediaRepository = repository,
    currentTime: Date | (() => Date) = NOW,
    mediaRepository: MediaRepository = createDatabaseMediaRepository(database),
    reservedUploadIoTimeoutMs?: number,
  ) {
    const service = createMediaService({
      storage,
      repository: mediaRepository,
      config: {
        publicBucket: "lumapos-test-public-media",
        privateBucket: "lumapos-test-private-media",
      },
      authorizeTarget: async () => "allowed",
      now: typeof currentTime === "function" ? currentTime : () => currentTime,
      logger: { error() {} },
      reservedUploadIoTimeoutMs,
    });
    return createProjectMediaManager({
      authorizeProject: async () => "allowed",
      repository: projectRepository,
      mediaService: service,
      sign: async (record: ProjectMediaInternalRecord) =>
        `https://r2.test/${record.objectKey}?signed=1`,
      compensate: (
        input: Parameters<typeof compensateManagedMediaAssociation>[1],
      ) => compensateManagedMediaAssociation(database, input),
      logger: { error() {} },
    });
  }

  function objectStorageHarness(
    firstFailure?: "ambiguous-before" | "ambiguous-after" | "definitive-before",
  ) {
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const putKeys: string[] = [];
    let first = true;
    const storage: ObjectStorage = {
      async put(input) {
        putKeys.push(input.key);
        const coordinate = `${input.bucket}:${input.key}`;
        if (first && (
          firstFailure === "ambiguous-before"
          || firstFailure === "definitive-before"
        )) {
          first = false;
          throw new ObjectStorageWriteError(
            firstFailure === "definitive-before"
              ? "provider rejected before write"
              : "connection lost before commit",
            firstFailure === "definitive-before" ? "definitive-no-write" : "ambiguous",
          );
        }
        if (input.ifNoneMatch === "*" && objects.has(coordinate)) {
          throw new ObjectStorageWriteError("precondition failed", "definitive-no-write");
        }
        objects.set(coordinate, {
          bytes: input.body.slice(),
          contentType: input.contentType,
        });
        if (first && firstFailure === "ambiguous-after") {
          first = false;
          throw new ObjectStorageWriteError("connection lost after commit", "ambiguous");
        }
        first = false;
        return {
          sizeBytes: input.body.byteLength,
          contentType: input.contentType,
          etag: "stored",
        };
      },
      async get(input) {
        const value = objects.get(`${input.bucket}:${input.key}`);
        if (!value) throw new Error("missing object");
        return value.bytes;
      },
      async head(input) {
        const value = objects.get(`${input.bucket}:${input.key}`);
        return value ? {
          sizeBytes: value.bytes.byteLength,
          contentType: value.contentType,
          etag: "stored",
        } : null;
      },
      async createUploadUrl() { return "https://r2.test/upload"; },
      async createDownloadUrl(input) {
        return `https://r2.test/${input.key}?expires=${input.expiresInSeconds}`;
      },
      async remove() {},
      publicUrl(input) { return `https://r2.test/${input.key}`; },
    };
    return { storage, objects, putKeys };
  }

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

  test("uses the production media repository against the same PGlite registry", async () => {
    const mediaRepository = createDatabaseMediaRepository(database);

    expect(await mediaRepository.getForStore({
      storeId: STORE_ID,
      mediaId: MEDIA_ID,
    })).toMatchObject({
      id: MEDIA_ID,
      storeId: STORE_ID,
      status: "ready",
      purpose: "project-document",
      targetId: PROJECT_ID,
    });
  });

  test("reserves one deterministic pending media row for a repeated request id", async () => {
    const mediaRepository = createDatabaseMediaRepository(database);
    const input = {
      id: RESERVATION_ID,
      storeId: STORE_ID,
      provider: "r2" as const,
      visibility: "private" as const,
      purpose: "project-document" as const,
      targetId: PROJECT_ID,
      domain: "projects",
      bucket: "lumapos-test-private-media",
      objectKey: `stores/${STORE_ID}/projects/2026/08/${RESERVATION_ID}/original.pdf`,
      originalFileName: "reserved.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      sha256: "e".repeat(64),
      uploadExpiresAt: new Date(NOW.getTime() + 600_000),
      createdBy: USER_ID,
    };

    expect(await mediaRepository.reservePending(input)).toMatchObject({
      created: true,
      media: { id: RESERVATION_ID, sha256: "e".repeat(64) },
    });
    expect(await mediaRepository.reservePending(input)).toMatchObject({
      created: false,
      media: { id: RESERVATION_ID, sha256: "e".repeat(64) },
    });
    expect(await database.select().from(mediaObjects).where(eq(
      mediaObjects.id,
      RESERVATION_ID,
    ))).toHaveLength(1);
  });

  test("reserves exact project request metadata against pending managed media", async () => {
    await database.insert(mediaObjects).values({
      id: PROJECT_UPLOAD_ID,
      storeId: STORE_ID,
      provider: "r2",
      visibility: "private",
      purpose: "project-document",
      targetId: PROJECT_ID,
      domain: "projects",
      bucket: "lumapos-test-private-media",
      objectKey: `stores/${STORE_ID}/projects/2026/08/${PROJECT_UPLOAD_ID}/original.pdf`,
      originalFileName: "handover-reserved.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      sha256: "f".repeat(64),
      status: "pending",
      uploadExpiresAt: new Date(NOW.getTime() + 600_000),
      createdBy: USER_ID,
    });
    const input = {
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      mediaId: PROJECT_UPLOAD_ID,
      expectedPath: `stores/${STORE_ID}/projects/2026/08/${PROJECT_UPLOAD_ID}/original.pdf`,
      phase: "handover" as const,
      caption: "Biên bản bàn giao",
      documentId: DOCUMENT_ID,
      fileName: "handover-reserved.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      sha256: "f".repeat(64),
      idempotencyKey: PROJECT_UPLOAD_ID,
      createdAt: NOW,
    };

    expect(await repository.reserveProjectAttachment(input)).toMatchObject({
      mediaStatus: "pending",
      record: {
        id: PROJECT_UPLOAD_ID,
        mediaId: PROJECT_UPLOAD_ID,
        phase: "handover",
      },
      documentIds: [DOCUMENT_ID],
      sha256: "f".repeat(64),
    });
    expect(await repository.reserveProjectAttachment(input)).toMatchObject({
      mediaStatus: "pending",
      record: { id: PROJECT_UPLOAD_ID, mediaId: PROJECT_UPLOAD_ID },
    });
    expect(await database.select().from(serviceAttachments).where(eq(
      serviceAttachments.id,
      PROJECT_UPLOAD_ID,
    ))).toHaveLength(1);

    await database.update(mediaObjects).set({
      status: "ready",
      readyAt: NOW,
      verifiedAt: NOW,
    }).where(eq(mediaObjects.id, PROJECT_UPLOAD_ID));
    expect(await repository.createProjectAttachment(input)).toMatchObject({
      id: PROJECT_UPLOAD_ID,
      mediaId: PROJECT_UPLOAD_ID,
      phase: "handover",
    });
    expect(await database.select().from(serviceHandoverDocumentMedia).where(eq(
      serviceHandoverDocumentMedia.mediaObjectId,
      PROJECT_UPLOAD_ID,
    ))).toHaveLength(1);
  });

  test("retries an ambiguous-after PUT through one media key and one attachment", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const objects = new Map<string, Uint8Array>();
    const putKeys: string[] = [];
    let ambiguousAfter = true;
    const storage: ObjectStorage = {
      async put(input) {
        putKeys.push(input.key);
        const coordinate = `${input.bucket}:${input.key}`;
        if (input.ifNoneMatch === "*" && objects.has(coordinate)) {
          throw new ObjectStorageWriteError("precondition failed", "definitive-no-write");
        }
        objects.set(coordinate, input.body.slice());
        if (ambiguousAfter) {
          ambiguousAfter = false;
          throw new ObjectStorageWriteError("connection lost after commit", "ambiguous");
        }
        return {
          sizeBytes: input.body.byteLength,
          contentType: input.contentType,
          etag: "stored",
        };
      },
      async get(input) {
        const value = objects.get(`${input.bucket}:${input.key}`);
        if (!value) throw new Error("missing object");
        return value;
      },
      async head(input) {
        const value = objects.get(`${input.bucket}:${input.key}`);
        return value ? {
          sizeBytes: value.byteLength,
          contentType: "application/pdf",
          etag: "stored",
        } : null;
      },
      async createUploadUrl() { return "https://r2.test/upload"; },
      async createDownloadUrl(input) {
        return `https://r2.test/${input.key}?expires=${input.expiresInSeconds}`;
      },
      async remove() {},
      publicUrl(input) { return `https://r2.test/${input.key}`; },
    };
    const generatedIds = [AMBIGUOUS_UPLOAD_ID, DUPLICATE_UPLOAD_ID];
    const service = createMediaService({
      storage,
      repository: createDatabaseMediaRepository(database),
      config: {
        publicBucket: "lumapos-test-public-media",
        privateBucket: "lumapos-test-private-media",
      },
      authorizeTarget: async () => "allowed",
      now: () => NOW,
      randomUUID: () => generatedIds.shift() ?? DUPLICATE_UPLOAD_ID,
      logger: { error() {} },
    });
    const manager = createProjectMediaManager({
      authorizeProject: async () => "allowed",
      repository,
      mediaService: service,
      sign: async (record: ProjectMediaInternalRecord) =>
        `https://r2.test/${record.objectKey}?signed=1`,
      compensate: (
        input: Parameters<typeof compensateManagedMediaAssociation>[1],
      ) => compensateManagedMediaAssociation(database, input),
      logger: { error() {} },
    });
    const input = {
      phase: "handover" as const,
      caption: "Biên bản retry",
      documentId: DOCUMENT_ID,
      fileName: "ambiguous-retry.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: AMBIGUOUS_UPLOAD_ID,
    };

    await expect(manager.upload(actor, PROJECT_ID, input, bytes)).rejects.toThrow(
      "connection lost after commit",
    );
    const result = await manager.upload(actor, PROJECT_ID, input, bytes);

    expect(result).toMatchObject({
      id: AMBIGUOUS_UPLOAD_ID,
      mediaId: AMBIGUOUS_UPLOAD_ID,
    });
    expect(await database.select({ id: mediaObjects.id, key: mediaObjects.objectKey })
      .from(mediaObjects).where(inArray(mediaObjects.id, [
        AMBIGUOUS_UPLOAD_ID,
        DUPLICATE_UPLOAD_ID,
      ]))).toEqual([{
        id: AMBIGUOUS_UPLOAD_ID,
        key: expect.stringContaining(`/${AMBIGUOUS_UPLOAD_ID}/original.pdf`),
      }]);
    expect(await database.select({
      id: serviceAttachments.id,
      mediaId: serviceAttachments.mediaObjectId,
    }).from(serviceAttachments).where(eq(
      serviceAttachments.id,
      AMBIGUOUS_UPLOAD_ID,
    ))).toEqual([{ id: AMBIGUOUS_UPLOAD_ID, mediaId: AMBIGUOUS_UPLOAD_ID }]);
    expect(new Set(putKeys)).toEqual(new Set([
      expect.stringContaining(`/${AMBIGUOUS_UPLOAD_ID}/original.pdf`),
    ]));
  });

  test("retries an ambiguous-before PUT through the same pending row and hidden reservation", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, objects, putKeys } = objectStorageHarness("ambiguous-before");
    const manager = databaseBackedManager(storage);
    const input = {
      phase: "acceptance" as const,
      caption: "Nghiệm thu retry",
      documentId: DOCUMENT_ID,
      fileName: "ambiguous-before.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: AMBIGUOUS_BEFORE_ID,
    };

    await expect(manager.upload(actor, PROJECT_ID, input, bytes)).rejects.toThrow(
      "connection lost before commit",
    );
    expect(await repository.listProjectAttachments({
      storeId: STORE_ID,
      projectId: PROJECT_ID,
    })).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: AMBIGUOUS_BEFORE_ID }),
    ]));
    expect(await repository.getProjectAttachment({
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      attachmentId: AMBIGUOUS_BEFORE_ID,
    })).toBeNull();
    expect(await listProjectAttachmentSummaries(database, {
      storeId: STORE_ID,
      projectId: PROJECT_ID,
    })).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: AMBIGUOUS_BEFORE_ID }),
    ]));
    await expect(manager.download(
      actor,
      PROJECT_ID,
      AMBIGUOUS_BEFORE_ID,
    )).rejects.toMatchObject({ status: 404 });
    await expect(manager.delete(
      actor,
      PROJECT_ID,
      AMBIGUOUS_BEFORE_ID,
    )).rejects.toMatchObject({ status: 404 });
    expect(await database.select({
      id: serviceAttachments.id,
      mediaId: serviceAttachments.mediaObjectId,
    }).from(serviceAttachments).where(eq(
      serviceAttachments.id,
      AMBIGUOUS_BEFORE_ID,
    ))).toEqual([{ id: AMBIGUOUS_BEFORE_ID, mediaId: null }]);
    expect(await database.select().from(serviceHandoverDocumentMedia).where(eq(
      serviceHandoverDocumentMedia.mediaObjectId,
      AMBIGUOUS_BEFORE_ID,
    ))).toHaveLength(0);

    expect(await manager.upload(actor, PROJECT_ID, input, bytes)).toMatchObject({
      id: AMBIGUOUS_BEFORE_ID,
      mediaId: AMBIGUOUS_BEFORE_ID,
    });
    expect(putKeys).toHaveLength(2);
    expect(new Set(putKeys)).toHaveLength(1);
    expect(objects).toHaveLength(1);
    expect(await database.select().from(mediaObjects).where(eq(
      mediaObjects.id,
      AMBIGUOUS_BEFORE_ID,
    ))).toHaveLength(1);
  });

  test("retains one retryable reservation after a definitive no-write provider result", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, objects, putKeys } = objectStorageHarness("definitive-before");
    const manager = databaseBackedManager(storage);
    const input = {
      phase: "construction" as const,
      caption: null,
      fileName: "definitive-retry.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: DUPLICATE_UPLOAD_ID,
    };

    await expect(manager.upload(actor, PROJECT_ID, input, bytes)).rejects.toThrow(
      "provider rejected before write",
    );
    expect(await database.select({
      status: mediaObjects.status,
      key: mediaObjects.objectKey,
    }).from(mediaObjects).where(eq(
      mediaObjects.id,
      DUPLICATE_UPLOAD_ID,
    ))).toEqual([{
      status: "pending",
      key: expect.stringContaining(`/${DUPLICATE_UPLOAD_ID}/original.jpg`),
    }]);
    expect(await manager.upload(actor, PROJECT_ID, input, bytes)).toMatchObject({
      id: DUPLICATE_UPLOAD_ID,
      mediaId: DUPLICATE_UPLOAD_ID,
    });
    expect(putKeys).toHaveLength(2);
    expect(new Set(putKeys)).toHaveLength(1);
    expect(objects).toHaveLength(1);
  });

  test("terminalizes an expired empty reservation without a second provider write", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, objects, putKeys } = objectStorageHarness("ambiguous-before");
    const input = {
      phase: "after_installation" as const,
      caption: null,
      fileName: "expired-empty.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: EXPIRED_EMPTY_RESERVATION_ID,
    };

    await expect(databaseBackedManager(storage).upload(
      actor,
      PROJECT_ID,
      input,
      bytes,
    )).rejects.toThrow("connection lost before commit");

    await expect(databaseBackedManager(
      storage,
      repository,
      new Date(NOW.getTime() + 600_000),
    ).upload(actor, PROJECT_ID, input, bytes)).rejects.toMatchObject({
      error: "media.uploadExpired",
      status: 410,
    });

    expect(putKeys).toHaveLength(1);
    expect(objects).toHaveLength(0);
    expect(await database.select({ status: mediaObjects.status }).from(mediaObjects).where(eq(
      mediaObjects.id,
      EXPIRED_EMPTY_RESERVATION_ID,
    ))).toEqual([{ status: "deleted" }]);
    expect(await database.select({
      mediaId: serviceAttachments.mediaObjectId,
      deletedAt: serviceAttachments.deletedAt,
    }).from(serviceAttachments).where(eq(
      serviceAttachments.id,
      EXPIRED_EMPTY_RESERVATION_ID,
    ))).toEqual([{ mediaId: null, deletedAt: expect.any(Date) }]);
  });

  test("quarantines an expired reservation when its exact key has mismatched bytes", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, objects, putKeys } = objectStorageHarness("ambiguous-before");
    const input = {
      phase: "after_installation" as const,
      caption: null,
      fileName: "expired-mismatch.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: EXPIRED_MISMATCH_RESERVATION_ID,
    };

    await expect(databaseBackedManager(storage).upload(
      actor,
      PROJECT_ID,
      input,
      bytes,
    )).rejects.toThrow("connection lost before commit");

    const [reserved] = await database.select({
      bucket: mediaObjects.bucket,
      objectKey: mediaObjects.objectKey,
    }).from(mediaObjects).where(eq(mediaObjects.id, EXPIRED_MISMATCH_RESERVATION_ID));
    objects.set(`${reserved.bucket}:${reserved.objectKey}`, {
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
      contentType: "image/jpeg",
    });

    await expect(databaseBackedManager(
      storage,
      repository,
      new Date(NOW.getTime() + 600_000),
    ).upload(actor, PROJECT_ID, input, bytes)).rejects.toMatchObject({
      error: "media.reservationConflict",
      status: 409,
    });

    expect(putKeys).toHaveLength(1);
    expect(await database.select({ status: mediaObjects.status }).from(mediaObjects).where(eq(
      mediaObjects.id,
      EXPIRED_MISMATCH_RESERVATION_ID,
    ))).toEqual([{ status: "quarantined" }]);
    expect(await database.select({
      mediaId: serviceAttachments.mediaObjectId,
      deletedAt: serviceAttachments.deletedAt,
    }).from(serviceAttachments).where(eq(
      serviceAttachments.id,
      EXPIRED_MISMATCH_RESERVATION_ID,
    ))).toEqual([{ mediaId: null, deletedAt: expect.any(Date) }]);
  });

  test("keeps a pre-expiry managed upload fenced at its original expiry", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const putKeys: string[] = [];
    const removeCalls: string[] = [];
    let releasePut: (() => void) | null = null;
    let signalPutEntered: (() => void) | null = null;
    const putEntered = new Promise<void>((resolve) => {
      signalPutEntered = resolve;
    });
    const putReleased = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const storage: ObjectStorage = {
      async put(input) {
        putKeys.push(input.key);
        const coordinate = `${input.bucket}:${input.key}`;
        if (input.ifNoneMatch === "*" && objects.has(coordinate)) {
          throw new ObjectStorageWriteError("precondition failed", "definitive-no-write");
        }
        if (putKeys.length === 1) {
          signalPutEntered?.();
          await putReleased;
        }
        objects.set(coordinate, {
          bytes: input.body.slice(),
          contentType: input.contentType,
        });
        return {
          sizeBytes: input.body.byteLength,
          contentType: input.contentType,
          etag: "stored",
        };
      },
      async get(input) {
        const value = objects.get(`${input.bucket}:${input.key}`);
        if (!value) throw new Error("missing object");
        return value.bytes;
      },
      async head(input) {
        const value = objects.get(`${input.bucket}:${input.key}`);
        return value ? {
          sizeBytes: value.bytes.byteLength,
          contentType: value.contentType,
          etag: "stored",
        } : null;
      },
      async createUploadUrl() { return "https://r2.test/upload"; },
      async createDownloadUrl(input) {
        return `https://r2.test/${input.key}?expires=${input.expiresInSeconds}`;
      },
      async remove(input) { removeCalls.push(input.key); },
      publicUrl(input) { return `https://r2.test/${input.key}`; },
    };
    const input = {
      phase: "handover" as const,
      caption: "Expiry fence",
      documentId: DOCUMENT_ID,
      fileName: "expiry-fence.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: EXPIRY_FENCE_RESERVATION_ID,
    };
    let currentTime = NOW;
    const first = databaseBackedManager(storage, repository, () => currentTime).upload(
      actor,
      PROJECT_ID,
      input,
      bytes,
    );
    await putEntered;

    currentTime = new Date(NOW.getTime() + 600_000);

    const baseRepository = createDatabaseMediaRepository(database);
    let terminalizationAttempted = false;
    const secondRepository: MediaRepository = {
      ...baseRepository,
      async withReservedUploadLock(lockInput, operation) {
        return baseRepository.withReservedUploadLock(
          lockInput,
          async (lock: ReservedMediaUploadLock) => operation({
            ...lock,
            async abandonPending(reservation) {
              terminalizationAttempted = true;
              return lock.abandonPending(reservation);
            },
            async quarantinePending(reservation) {
              terminalizationAttempted = true;
              return lock.quarantinePending(reservation);
            },
          }),
        );
      },
    };
    const second = databaseBackedManager(
      storage,
      repository,
      () => currentTime,
      secondRepository,
    ).upload(actor, PROJECT_ID, input, bytes);
    let secondSettled = false;
    void second.finally(() => { secondSettled = true; }).catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(terminalizationAttempted).toBe(false);
    expect(secondSettled).toBe(false);
    expect(putKeys).toHaveLength(1);
    expect(objects).toHaveLength(0);
    const release = releasePut ?? (() => {
      throw new Error("paused PUT release was not initialized");
    });
    release();
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);

    expect(firstResult).toMatchObject({ status: "fulfilled" });
    expect(secondResult).toMatchObject({ status: "fulfilled" });
    expect(await database.select({
      id: mediaObjects.id,
      status: mediaObjects.status,
      key: mediaObjects.objectKey,
    }).from(mediaObjects).where(eq(
      mediaObjects.id,
      EXPIRY_FENCE_RESERVATION_ID,
    ))).toEqual([{
      id: EXPIRY_FENCE_RESERVATION_ID,
      status: "ready",
      key: expect.stringContaining(`/${EXPIRY_FENCE_RESERVATION_ID}/original.pdf`),
    }]);
    expect(await database.select({
      id: serviceAttachments.id,
      mediaId: serviceAttachments.mediaObjectId,
      deletedAt: serviceAttachments.deletedAt,
    }).from(serviceAttachments).where(eq(
      serviceAttachments.id,
      EXPIRY_FENCE_RESERVATION_ID,
    ))).toEqual([{
      id: EXPIRY_FENCE_RESERVATION_ID,
      mediaId: EXPIRY_FENCE_RESERVATION_ID,
      deletedAt: null,
    }]);
    expect(putKeys).toEqual([
      expect.stringContaining(`/${EXPIRY_FENCE_RESERVATION_ID}/original.pdf`),
    ]);
    expect(objects).toHaveLength(1);
    expect(removeCalls).toEqual([]);
  });

  test("reconciles a hung fenced upload at expiry without deleting physical objects", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const scenarios = [
      {
        id: HUNG_EXACT_RESERVATION_ID,
        object: "exact",
        status: "ready",
        error: null,
      },
      {
        id: HUNG_MISSING_RESERVATION_ID,
        object: "missing",
        status: "deleted",
        error: { error: "media.uploadExpired", status: 410 },
      },
      {
        id: HUNG_MISMATCH_RESERVATION_ID,
        object: "mismatch",
        status: "quarantined",
        error: { error: "media.reservationConflict", status: 409 },
      },
    ] as const;

    for (const scenario of scenarios) {
      const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
      const putKeys: string[] = [];
      const removeCalls: string[] = [];
      let firstPut = true;
      const storage: ObjectStorage = {
        async put(input) {
          putKeys.push(input.key);
          if (firstPut) {
            firstPut = false;
            await new Promise<void>((_resolve, reject) => {
              const rejectAborted = () => reject(new Error("provider call aborted"));
              if (input.signal?.aborted) {
                rejectAborted();
                return;
              }
              input.signal?.addEventListener("abort", rejectAborted, { once: true });
            });
          }
          const coordinate = `${input.bucket}:${input.key}`;
          if (input.ifNoneMatch === "*" && objects.has(coordinate)) {
            throw new ObjectStorageWriteError("precondition failed", "definitive-no-write");
          }
          objects.set(coordinate, {
            bytes: input.body.slice(),
            contentType: input.contentType,
          });
          return {
            sizeBytes: input.body.byteLength,
            contentType: input.contentType,
            etag: "stored",
          };
        },
        async get(input) {
          const object = objects.get(`${input.bucket}:${input.key}`);
          if (!object) throw new Error("missing object");
          return object.bytes;
        },
        async head(input) {
          const object = objects.get(`${input.bucket}:${input.key}`);
          return object ? {
            sizeBytes: object.bytes.byteLength,
            contentType: object.contentType,
            etag: "stored",
          } : null;
        },
        async createUploadUrl() { return "https://r2.test/upload"; },
        async createDownloadUrl(input) {
          return `https://r2.test/${input.key}?expires=${input.expiresInSeconds}`;
        },
        async remove(input) { removeCalls.push(input.key); },
        publicUrl(input) { return `https://r2.test/${input.key}`; },
      };
      const input = {
        phase: "handover" as const,
        caption: "Hung writer",
        documentId: DOCUMENT_ID,
        fileName: `hung-${scenario.object}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        idempotencyKey: scenario.id,
      };

      await expect(databaseBackedManager(
        storage,
        repository,
        NOW,
        createDatabaseMediaRepository(database),
        10,
      ).upload(actor, PROJECT_ID, input, bytes)).rejects.toMatchObject({
        error: "media.uploadInProgress",
        status: 503,
      });

      const [reserved] = await database.select({
        bucket: mediaObjects.bucket,
        objectKey: mediaObjects.objectKey,
        status: mediaObjects.status,
      }).from(mediaObjects).where(eq(mediaObjects.id, scenario.id));
      expect(reserved.status).toBe("pending");
      if (scenario.object === "exact") {
        objects.set(`${reserved.bucket}:${reserved.objectKey}`, {
          bytes: bytes.slice(),
          contentType: "application/pdf",
        });
      }
      if (scenario.object === "mismatch") {
        objects.set(`${reserved.bucket}:${reserved.objectKey}`, {
          bytes: Uint8Array.from([1, 2, 3, 5]),
          contentType: "application/pdf",
        });
      }

      const retry = databaseBackedManager(
        storage,
        repository,
        new Date(NOW.getTime() + 600_000),
      ).upload(actor, PROJECT_ID, input, bytes);
      if (scenario.error) {
        await expect(retry).rejects.toMatchObject(scenario.error);
      } else {
        await expect(retry).resolves.toMatchObject({
          id: scenario.id,
          mediaId: scenario.id,
        });
      }

      expect(await database.select({
        status: mediaObjects.status,
      }).from(mediaObjects).where(eq(mediaObjects.id, scenario.id))).toEqual([{
        status: scenario.status,
      }]);
      expect(await database.select({
        mediaId: serviceAttachments.mediaObjectId,
        deletedAt: serviceAttachments.deletedAt,
      }).from(serviceAttachments).where(eq(
        serviceAttachments.id,
        scenario.id,
      ))).toEqual(scenario.status === "ready"
        ? [{ mediaId: scenario.id, deletedAt: null }]
        : [{ mediaId: null, deletedAt: expect.any(Date) }]);
      expect(putKeys).toHaveLength(1);
      expect(removeCalls).toEqual([]);
      expect(objects).toHaveLength(scenario.object === "missing" ? 0 : 1);
    }
  });

  test("cleans a hidden reservation only after reconciliation makes its media terminal", async () => {
    const sha256 = "b".repeat(64);
    const expectedPath = `stores/${STORE_ID}/projects/2026/08/${TERMINAL_RESERVATION_ID}/original.jpg`;
    await database.insert(mediaObjects).values({
      id: TERMINAL_RESERVATION_ID,
      storeId: STORE_ID,
      provider: "r2",
      visibility: "private",
      purpose: "project-document",
      targetId: PROJECT_ID,
      domain: "projects",
      bucket: "lumapos-test-private-media",
      objectKey: expectedPath,
      originalFileName: "expired.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256,
      status: "pending",
      uploadExpiresAt: new Date(NOW.getTime() - 1),
      createdBy: USER_ID,
    });
    await repository.reserveProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      mediaId: TERMINAL_RESERVATION_ID,
      expectedPath,
      phase: "after_installation",
      caption: null,
      fileName: "expired.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256,
      idempotencyKey: TERMINAL_RESERVATION_ID,
      createdAt: NOW,
    });

    expect(await cleanupTerminalProjectAttachmentReservation(database, {
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      mediaId: TERMINAL_RESERVATION_ID,
      attachmentId: TERMINAL_RESERVATION_ID,
      cleanedAt: NOW,
    })).toEqual({ outcome: "retained" });
    await database.update(mediaObjects).set({
      status: "deleted",
      deletedAt: NOW,
    }).where(eq(mediaObjects.id, TERMINAL_RESERVATION_ID));
    expect(await cleanupTerminalProjectAttachmentReservation(database, {
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      mediaId: TERMINAL_RESERVATION_ID,
      attachmentId: TERMINAL_RESERVATION_ID,
      cleanedAt: NOW,
    })).toEqual({ outcome: "cleaned" });
    expect(await database.select({ deletedAt: serviceAttachments.deletedAt })
      .from(serviceAttachments).where(eq(
        serviceAttachments.id,
        TERMINAL_RESERVATION_ID,
      ))).toEqual([{ deletedAt: NOW }]);
  });

  test("soft-deletes the hidden reservation after terminal association recovery", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, objects } = objectStorageHarness();
    const raceRepository: ProjectMediaRepository = {
      ...repository,
      async reserveProjectAttachment(input) {
        const reserved = await repository.reserveProjectAttachment(input);
        await database.delete(serviceHandoverDocuments).where(eq(
          serviceHandoverDocuments.id,
          DOCUMENT_ID,
        ));
        return reserved;
      },
    };
    const manager = databaseBackedManager(storage, raceRepository);
    try {
      await expect(manager.upload(actor, PROJECT_ID, {
        phase: "handover",
        caption: null,
        documentId: DOCUMENT_ID,
        fileName: "terminal-race.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        idempotencyKey: TERMINAL_RACE_ID,
      }, bytes)).rejects.toMatchObject({
        code: "PROJECT_MEDIA_DOCUMENT_NOT_FOUND",
      });
      expect(await database.select({ status: mediaObjects.status })
        .from(mediaObjects).where(eq(
          mediaObjects.id,
          TERMINAL_RACE_ID,
        ))).toEqual([{ status: "deleted" }]);
      expect(await database.select({
        mediaId: serviceAttachments.mediaObjectId,
        deletedAt: serviceAttachments.deletedAt,
      }).from(serviceAttachments).where(eq(
        serviceAttachments.id,
        TERMINAL_RACE_ID,
      ))).toEqual([{ mediaId: null, deletedAt: expect.any(Date) }]);
      expect(objects).toHaveLength(1);
    } finally {
      await database.insert(serviceHandoverDocuments).values({
        id: DOCUMENT_ID,
        storeId: STORE_ID,
        projectId: PROJECT_ID,
        type: "handover",
        title: "Handover",
      }).onConflictDoNothing();
      await database.insert(serviceHandoverDocumentMedia).values({
        storeId: STORE_ID,
        documentId: DOCUMENT_ID,
        mediaObjectId: MEDIA_ID,
        sortOrder: 0,
      }).onConflictDoNothing();
    }
  });

  test("concurrent same-key retries converge on one media row, key, and attachment", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, objects, putKeys } = objectStorageHarness();
    const manager = databaseBackedManager(storage);
    const input = {
      phase: "after_installation" as const,
      caption: null,
      fileName: "concurrent.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: CONCURRENT_UPLOAD_ID,
    };

    const results = await Promise.all([
      manager.upload(actor, PROJECT_ID, input, bytes),
      manager.upload(actor, PROJECT_ID, input, bytes),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ id: CONCURRENT_UPLOAD_ID, mediaId: CONCURRENT_UPLOAD_ID }),
      expect.objectContaining({ id: CONCURRENT_UPLOAD_ID, mediaId: CONCURRENT_UPLOAD_ID }),
    ]);
    expect(await database.select().from(mediaObjects).where(eq(
      mediaObjects.id,
      CONCURRENT_UPLOAD_ID,
    ))).toHaveLength(1);
    expect(await database.select().from(serviceAttachments).where(eq(
      serviceAttachments.id,
      CONCURRENT_UPLOAD_ID,
    ))).toHaveLength(1);
    expect(new Set(putKeys)).toHaveLength(1);
    expect(objects).toHaveLength(1);
  });

  test("rejects every changed pending payload coordinate without writing another object", async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
    const { storage, putKeys } = objectStorageHarness("ambiguous-before");
    const manager = databaseBackedManager(storage);
    const input = {
      phase: "handover" as const,
      caption: "Bản gốc",
      documentId: DOCUMENT_ID,
      fileName: "unchanged.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      idempotencyKey: CHANGED_UPLOAD_ID,
    };
    await expect(manager.upload(actor, PROJECT_ID, input, bytes)).rejects.toThrow(
      "connection lost before commit",
    );

    const fiveBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
    const changed = [
      { label: "phase", value: { ...input, phase: "acceptance" }, body: bytes },
      { label: "caption", value: { ...input, caption: "Đã đổi" }, body: bytes },
      { label: "document", value: { ...input, documentId: undefined }, body: bytes },
      { label: "name", value: { ...input, fileName: "changed.jpg" }, body: bytes },
      { label: "mime", value: { ...input, mimeType: "image/png" }, body: bytes },
      {
        label: "size",
        value: {
          ...input,
          sizeBytes: fiveBytes.byteLength,
          sha256: createHash("sha256").update(fiveBytes).digest("hex"),
        },
        body: fiveBytes,
      },
      { label: "sha", value: { ...input, sha256: "f".repeat(64) }, body: bytes },
    ];
    const failures: Array<{ label: string; status: unknown; name: unknown }> = [];
    for (const candidate of changed) {
      try {
        await manager.upload(actor, PROJECT_ID, candidate.value, candidate.body);
        failures.push({ label: candidate.label, status: "resolved", name: null });
      } catch (error) {
        const failure = error as { status?: unknown; name?: unknown };
        failures.push({
          label: candidate.label,
          status: failure.status,
          name: failure.name,
        });
      }
    }
    expect(failures).toEqual(changed.map(({ label }) => ({
      label,
      status: 409,
      name: expect.any(String),
    })));
    expect(putKeys).toHaveLength(1);
    expect(await database.select().from(mediaObjects).where(eq(
      mediaObjects.id,
      CHANGED_UPLOAD_ID,
    ))).toHaveLength(1);
    expect(await database.select({ mediaId: serviceAttachments.mediaObjectId })
      .from(serviceAttachments).where(eq(
        serviceAttachments.id,
        CHANGED_UPLOAD_ID,
      ))).toEqual([{ mediaId: null }]);
  });

  test("conceals reservation UUID collisions across store, purpose, and target", async () => {
    const sha256 = "a".repeat(64);
    await database.insert(mediaObjects).values([
      {
        id: CROSS_STORE_RESERVATION_ID,
        storeId: STORE_B,
        provider: "r2",
        visibility: "private",
        purpose: "project-document",
        targetId: PROJECT_B,
        domain: "projects",
        bucket: "lumapos-test-private-media",
        objectKey: `stores/${STORE_B}/projects/2026/08/${CROSS_STORE_RESERVATION_ID}/original.jpg`,
        originalFileName: "collision.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        sha256,
        status: "pending",
        uploadExpiresAt: new Date(NOW.getTime() + 600_000),
      },
      {
        id: CROSS_PURPOSE_RESERVATION_ID,
        storeId: STORE_ID,
        provider: "r2",
        visibility: "private",
        purpose: "service-evidence",
        targetId: JOB_ID,
        domain: "service-evidence",
        bucket: "lumapos-test-private-media",
        objectKey: `stores/${STORE_ID}/service-evidence/2026/08/${CROSS_PURPOSE_RESERVATION_ID}/original.jpg`,
        originalFileName: "collision.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        sha256,
        status: "pending",
        uploadExpiresAt: new Date(NOW.getTime() + 600_000),
      },
      {
        id: CROSS_TARGET_RESERVATION_ID,
        storeId: STORE_ID,
        provider: "r2",
        visibility: "private",
        purpose: "project-document",
        targetId: JOB_ID,
        domain: "projects",
        bucket: "lumapos-test-private-media",
        objectKey: `stores/${STORE_ID}/projects/2026/08/${CROSS_TARGET_RESERVATION_ID}/original.jpg`,
        originalFileName: "collision.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        sha256,
        status: "pending",
        uploadExpiresAt: new Date(NOW.getTime() + 600_000),
      },
    ]);
    const service = createMediaService({
      storage: objectStorageHarness().storage,
      repository: createDatabaseMediaRepository(database),
      config: {
        publicBucket: "lumapos-test-public-media",
        privateBucket: "lumapos-test-private-media",
      },
      authorizeTarget: async () => "allowed",
      now: () => NOW,
      logger: { error() {} },
    });
    for (const reservationId of [
      CROSS_STORE_RESERVATION_ID,
      CROSS_PURPOSE_RESERVATION_ID,
      CROSS_TARGET_RESERVATION_ID,
    ]) {
      await expect(service.reserveManagedObject(actor, {
        reservationId,
        purpose: "project-document",
        targetId: PROJECT_ID,
        fileName: "collision.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 4,
        sha256,
      })).rejects.toMatchObject({
        error: "media.reservationConflict",
        status: 409,
        message: "media.reservationConflict",
      });
    }
  });

  test("conceals a job attachment from project download lookup", async () => {
    const [jobAttachment] = await database.select({
      id: serviceAttachments.id,
    }).from(serviceAttachments).where(eq(serviceAttachments.jobId, JOB_ID)).limit(1);

    expect(await repository.getProjectAttachment({
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      attachmentId: jobAttachment.id,
    })).toBeNull();
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

  test("rechecks a deterministic attachment id under the project lock", async () => {
    const replay = await repository.createProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      mediaId: OTHER_MEDIA_ID,
      expectedPath: "unused-on-replay",
      phase: "after_installation",
      caption: null,
      documentId: DOCUMENT_ID,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "c".repeat(64),
      idempotencyKey: ATTACHMENT_ID,
    });

    expect(replay.id).toBe(ATTACHMENT_ID);
    expect(replay.mediaId).toBe(MEDIA_ID);
    await expect(repository.createProjectAttachment({
      storeId: STORE_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID,
      mediaId: OTHER_MEDIA_ID,
      expectedPath: "unused-on-conflict",
      phase: "after_installation",
      caption: "changed",
      documentId: DOCUMENT_ID,
      fileName: "site-after.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "c".repeat(64),
      idempotencyKey: ATTACHMENT_ID,
    })).rejects.toMatchObject({
      code: "PROJECT_MEDIA_ASSOCIATION_CONFLICT",
    });
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
      actorId: USER_ID.toUpperCase(),
      projectId: PROJECT_ID.toUpperCase(),
      attachmentId: ATTACHMENT_ID.toUpperCase(),
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

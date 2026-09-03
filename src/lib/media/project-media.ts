import "server-only";

import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inflateRawSync } from "node:zlib";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { recordActivity } from "@/lib/audit/activity-log";
import {
  mediaObjects,
  projects,
  serviceAttachments,
  serviceHandoverDocumentMedia,
  serviceHandoverDocuments,
} from "@/db/schema";
import {
  authorizeMediaTarget,
  canonicalizeMediaActor,
  type AuthorizeMediaTarget,
  type MediaActor,
  type MediaTargetAuthorization,
} from "@/lib/media/authorization";
import {
  recoverReadyMediaAfterFailureCore,
  softDeleteMediaIfUnreferencedCore,
  softDeleteMediaIfUnreferencedInTransaction,
  type RecoverReadyMediaAfterFailureResult,
} from "@/lib/media/repository-core";
import type {
  AbandonPendingMediaInput,
  CreatePendingMediaInput,
  GetMediaForStoreInput,
  MarkMediaReadyInput,
  QuarantinePendingMediaInput,
  SaveMediaThumbnailInput,
  SaveMediaMetadataInput,
  SoftDeleteMediaInput,
} from "@/lib/media/repository";
import { buildSaveMediaMetadataQuery, mediaRecordWithMetadata } from "@/lib/media/file-metadata-repository";
import {
  getMediaService,
  type MediaRecord,
  type MediaRepository,
  type MediaService,
  type ReservedMediaUploadLock,
  MediaServiceError,
} from "@/lib/media/service";
import type { MediaPurpose } from "@/lib/media/schemas";
import { getObjectStorage } from "@/lib/media/storage";
import type { MediaProvider, ObjectStorage } from "@/lib/media/types";
import {
  canonicalizeNullableUuidCoordinate,
  canonicalizeUuidCoordinate,
  canonicalUuidCoordinateSchema,
  nullableUuidCoordinatesEqual,
  uuidCoordinatesEqual,
} from "@/lib/media/uuid-coordinate";

// Drizzle's Node Postgres and PGlite adapters share the fluent operations used
// here. Keeping this core adapter-neutral lets the transaction invariants run
// against the same SQL engine in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseLike = any;

export const PROJECT_MEDIA_SIGNED_URL_SECONDS = 15 * 60;
export const PROJECT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const PROJECT_MEDIA_PHASES = [
  "survey",
  "construction",
  "after_installation",
  "acceptance",
  "handover",
  "other",
] as const;

export type ProjectMediaPhase = (typeof PROJECT_MEDIA_PHASES)[number];

const filenameSchema = z.string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value));

const nullableCaptionSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(500).nullable().optional().transform((value) => value ?? null),
);

const optionalDocumentIdSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  canonicalUuidCoordinateSchema.optional(),
);

export const projectMediaUploadSchema = z.object({
  phase: z.enum(PROJECT_MEDIA_PHASES),
  caption: nullableCaptionSchema,
  documentId: optionalDocumentIdSchema,
  fileName: filenameSchema,
  mimeType: z.string().trim().min(1).max(160).transform((value) => value.toLowerCase()),
  sizeBytes: z.number().int().positive().max(PROJECT_MEDIA_MAX_BYTES),
  idempotencyKey: canonicalUuidCoordinateSchema,
});

const managerUploadSchema = projectMediaUploadSchema.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function ascii(bytes: Uint8Array, start: number, end: number) {
  return new TextDecoder("ascii").decode(bytes.subarray(start, end));
}

function extensionOf(fileName: string) {
  const marker = fileName.lastIndexOf(".");
  return marker < 0 ? "" : fileName.slice(marker + 1).toLowerCase();
}

function hasPrefix(bytes: Uint8Array, expected: readonly number[]) {
  return bytes.length >= expected.length
    && expected.every((value, index) => bytes[index] === value);
}

function uint16(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

const ZIP_MAX_ENTRIES = 4_096;
const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const OPC_METADATA_MAX_BYTES = 2 * 1024 * 1024;
const OPC_INSPECTION_MAX_BYTES = 12 * 1024 * 1024;

type ParsedZipEntry = {
  name: string;
  flags: number;
  method: 0 | 8;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
};

type ParsedZip = {
  entries: Map<string, ParsedZipEntry>;
  lowerNames: Map<string, string>;
};

function decodeZipName(
  bytes: Uint8Array,
  start: number,
  length: number,
  utf8: boolean,
) {
  if (length < 1 || start < 0 || start + length > bytes.length) return null;
  try {
    const raw = bytes.subarray(start, start + length);
    if (!utf8 && raw.some((byte) => byte > 0x7f)) return null;
    const name = new TextDecoder(utf8 ? "utf-8" : "ascii", { fatal: true })
      .decode(raw);
    const segments = name.split("/");
    if (
      !name
      || name.includes("\\")
      || name.includes("\0")
      || name.includes("%")
      || name.includes(":")
      || name.startsWith("/")
      || name.includes("//")
      || segments.some((segment, index) =>
        (segment === "" && index !== segments.length - 1)
        || segment === "."
        || segment === "..")
    ) return null;
    return name;
  } catch {
    return null;
  }
}

function crc32(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

/** Strict, bounded ZIP directory parsing sufficient to inspect an OPC package. */
function parseZip(bytes: Uint8Array): ParsedZip | null {
  if (bytes.length < 22) return null;
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (uint32(bytes, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return null;
  const disk = uint16(bytes, endOffset + 4);
  const centralDisk = uint16(bytes, endOffset + 6);
  const diskEntries = uint16(bytes, endOffset + 8);
  const totalEntries = uint16(bytes, endOffset + 10);
  const centralSize = uint32(bytes, endOffset + 12);
  const centralOffset = uint32(bytes, endOffset + 16);
  const commentLength = uint16(bytes, endOffset + 20);
  if (
    disk !== 0
    || centralDisk !== 0
    || diskEntries === null
    || totalEntries === null
    || diskEntries !== totalEntries
    || totalEntries < 1
    || totalEntries > ZIP_MAX_ENTRIES
    || centralSize === null
    || centralOffset === null
    || commentLength === null
    || endOffset + 22 + commentLength !== bytes.length
    || centralOffset + centralSize !== endOffset
  ) return null;

  const entries = new Map<string, ParsedZipEntry>();
  const lowerNames = new Map<string, string>();
  const localRanges: Array<{ start: number; end: number }> = [];
  let totalUncompressedSize = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (uint32(bytes, offset) !== 0x02014b50) return null;
    const flags = uint16(bytes, offset + 8);
    const method = uint16(bytes, offset + 10);
    const checksum = uint32(bytes, offset + 16);
    const compressedSize = uint32(bytes, offset + 20);
    const uncompressedSize = uint32(bytes, offset + 24);
    const nameLength = uint16(bytes, offset + 28);
    const extraLength = uint16(bytes, offset + 30);
    const entryCommentLength = uint16(bytes, offset + 32);
    const localOffset = uint32(bytes, offset + 42);
    if (
      flags === null
      || (flags & 1) !== 0
      || (flags & 0x2060) !== 0
      || (method !== 0 && method !== 8)
      || checksum === null
      || compressedSize === null
      || uncompressedSize === null
      || uncompressedSize > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES
      || nameLength === null
      || extraLength === null
      || entryCommentLength === null
      || localOffset === null
    ) return null;
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) return null;
    if (method === 0 && compressedSize !== uncompressedSize) return null;
    const name = decodeZipName(
      bytes,
      offset + 46,
      nameLength,
      (flags & 0x0800) !== 0,
    );
    const next = offset + 46 + nameLength + extraLength + entryCommentLength;
    const lowerName = name?.toLowerCase();
    if (
      !name
      || !lowerName
      || next > endOffset
      || entries.has(name)
      || lowerNames.has(lowerName)
    ) return null;

    if (uint32(bytes, localOffset) !== 0x04034b50) return null;
    const localFlags = uint16(bytes, localOffset + 6);
    const localMethod = uint16(bytes, localOffset + 8);
    const localChecksum = uint32(bytes, localOffset + 14);
    const localCompressedSize = uint32(bytes, localOffset + 18);
    const localUncompressedSize = uint32(bytes, localOffset + 22);
    const localNameLength = uint16(bytes, localOffset + 26);
    const localExtraLength = uint16(bytes, localOffset + 28);
    if (
      localFlags !== flags
      || localMethod !== method
      || localChecksum === null
      || localCompressedSize === null
      || localUncompressedSize === null
      || localNameLength === null
      || localExtraLength === null
      || ((flags & 0x0008) === 0 && (
        localChecksum !== checksum
        || localCompressedSize !== compressedSize
        || localUncompressedSize !== uncompressedSize
      ))
      || ((flags & 0x0008) !== 0 && (
        ![0, checksum].includes(localChecksum)
        || ![0, compressedSize].includes(localCompressedSize)
        || ![0, uncompressedSize].includes(localUncompressedSize)
      ))
    ) return null;
    const localName = decodeZipName(
      bytes,
      localOffset + 30,
      localNameLength,
      (localFlags & 0x0800) !== 0,
    );
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      localName !== name
      || dataOffset + compressedSize > centralOffset
    ) return null;
    const dataEnd = dataOffset + compressedSize;
    let localEnd = dataEnd;
    if ((flags & 0x0008) !== 0) {
      if (uint32(bytes, localEnd) === 0x08074b50) localEnd += 4;
      const descriptorChecksum = uint32(bytes, localEnd);
      const descriptorCompressedSize = uint32(bytes, localEnd + 4);
      const descriptorUncompressedSize = uint32(bytes, localEnd + 8);
      if (
        descriptorChecksum !== checksum
        || descriptorCompressedSize !== compressedSize
        || descriptorUncompressedSize !== uncompressedSize
      ) return null;
      localEnd += 12;
    }
    localRanges.push({ start: localOffset, end: localEnd });
    entries.set(name, {
      name,
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      dataOffset,
    });
    lowerNames.set(lowerName, name);
    offset = next;
  }
  if (offset !== centralOffset + centralSize) return null;
  localRanges.sort((left, right) => left.start - right.start);
  if (
    localRanges[0]?.start !== 0
    || localRanges.at(-1)?.end !== centralOffset
    || localRanges.some((range, index) =>
      range.end > centralOffset
      || (index > 0 && range.start !== localRanges[index - 1].end)
    )
  ) return null;
  return { entries, lowerNames };
}

function readZipEntry(bytes: Uint8Array, entry: ParsedZipEntry) {
  const compressed = bytes.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  );
  let contents: Uint8Array;
  try {
    contents = entry.method === 0
      ? compressed
      : new Uint8Array(inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedSize),
      }));
  } catch {
    return null;
  }
  if (
    contents.byteLength !== entry.uncompressedSize
    || crc32(contents) !== entry.checksum
  ) return null;
  return contents;
}

function decodeXmlAttribute(value: string) {
  if (/&(?!amp;|quot;|apos;|lt;|gt;|#\d+;|#x[0-9a-f]+;)/i.test(value)) {
    return null;
  }
  let valid = true;
  const decoded = value.replace(
    /&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      if (entity === "&amp;") return "&";
      if (entity === "&quot;") return '"';
      if (entity === "&apos;") return "'";
      if (entity === "&lt;") return "<";
      if (entity === "&gt;") return ">";
      const numeric = entity[2].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(3, -1), 16)
        : Number.parseInt(entity.slice(2, -1), 10);
      if (
        !Number.isInteger(numeric)
        || numeric < 0x20
        || numeric > 0x10ffff
        || (numeric >= 0xd800 && numeric <= 0xdfff)
      ) {
        valid = false;
        return "";
      }
      return String.fromCodePoint(numeric);
    },
  );
  if (!valid) return null;
  return decoded;
}

function parseXmlAttributes(source: string) {
  const attributes = new Map<string, string>();
  let remaining = source;
  while (remaining.trim()) {
    const match = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(remaining);
    if (!match || attributes.has(match[1])) return null;
    const value = decodeXmlAttribute(match[2] ?? match[3] ?? "");
    if (value === null) return null;
    attributes.set(match[1], value);
    remaining = remaining.slice(match[0].length);
  }
  return attributes;
}

type FlatXmlChild = { name: string; attributes: Map<string, string> };

function parseFlatOpcXml(
  bytes: Uint8Array,
  expectedRoot: string,
  expectedNamespace: string,
  allowedChildren: ReadonlySet<string>,
): FlatXmlChild[] | null {
  if (bytes.byteLength < 1 || bytes.byteLength > OPC_METADATA_MAX_BYTES) return null;
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return null;
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1).trimStart();
  if (source.startsWith("<?xml")) {
    const end = source.indexOf("?>");
    if (end < 0) return null;
    source = source.slice(end + 2).trimStart();
  }
  if (source.includes("<!") || source.includes("<?")) return null;

  const tokens: Array<{
    name: string;
    closing: boolean;
    selfClosing: boolean;
    attributes: Map<string, string>;
  }> = [];
  const tag = /<([^<>]+)>/g;
  let cursor = 0;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    if (source.slice(cursor, match.index).trim()) return null;
    let body = match[1].trim();
    const closing = body.startsWith("/");
    const selfClosing = !closing && body.endsWith("/");
    if (closing) body = body.slice(1).trim();
    if (selfClosing) body = body.slice(0, -1).trimEnd();
    const parsed = /^([A-Za-z_][\w:.-]*)([\s\S]*)$/.exec(body);
    if (!parsed || (closing && parsed[2].trim())) return null;
    const attributes = closing ? new Map<string, string>() : parseXmlAttributes(parsed[2]);
    if (!attributes) return null;
    tokens.push({
      name: parsed[1].split(":").at(-1)!,
      closing,
      selfClosing,
      attributes,
    });
    cursor = tag.lastIndex;
  }
  if (source.slice(cursor).trim() || tokens.length < 2) return null;
  const root = tokens[0];
  const close = tokens.at(-1)!;
  if (
    root.name !== expectedRoot
    || root.closing
    || root.selfClosing
    || close.name !== expectedRoot
    || !close.closing
    || close.selfClosing
    || root.attributes.size !== 1
    || root.attributes.get("xmlns") !== expectedNamespace
  ) return null;
  const children: FlatXmlChild[] = [];
  for (const child of tokens.slice(1, -1)) {
    if (
      child.closing
      || !child.selfClosing
      || !allowedChildren.has(child.name)
    ) return null;
    children.push({ name: child.name, attributes: child.attributes });
  }
  return children;
}

function exactAttributes(
  attributes: Map<string, string>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  return required.every((key) => attributes.has(key))
    && [...attributes.keys()].every((key) =>
      required.includes(key) || optional.includes(key));
}

const OPC_CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const OPC_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OPC_RELATIONSHIP_DANGER =
  /\/(?:afchunk|attachedtemplate|attachedtoolbars|oleobject|package|vba|activex|control|externallink|externallinkpath|customui|webextension|webextensiontaskpanes|taskpanes)$/i;
const OPC_CONTENT_TYPE_DANGER =
  /(?:macroenabled|vba|activex|oleobject|embeddedpackage|webextension|taskpanes|x-msdownload|javascript|text\/html|image\/svg)/i;
const OPC_NAME_DANGER =
  /(?:^|\/)(?:activex|embeddings)(?:\/|$)|(?:^|\/)vbaproject\.bin$|\.(?:exe|dll|com|scr|msi|jar|js|vbs|ps1|bat|cmd|html?|svg)$/i;

const OPEN_XML_IDENTITIES = {
  docx: {
    mainPart: "word/document.xml",
    rootName: "document",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    mainPart: "xl/workbook.xml",
    rootName: "workbook",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    mainPart: "ppt/presentation.xml",
    rootName: "presentation",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
} as const;

function hasExpectedXmlRoot(bytes: Uint8Array, expectedRoot: string) {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart();
  } catch {
    return false;
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1).trimStart();
  if (source.startsWith("<?xml")) {
    const end = source.indexOf("?>");
    if (end < 0) return false;
    source = source.slice(end + 2).trimStart();
  }
  if (/<!\s*(?:doctype|entity)/i.test(source)) return false;
  while (source.startsWith("<!--")) {
    const end = source.indexOf("-->");
    if (end < 0) return false;
    source = source.slice(end + 3).trimStart();
  }
  const root = /^<([A-Za-z_][\w:.-]*)\b/.exec(source)?.[1];
  return root?.split(":").at(-1) === expectedRoot;
}

function relationshipSource(name: string) {
  if (name === "_rels/.rels") return "";
  const marker = name.lastIndexOf("/_rels/");
  if (marker < 0 || !name.endsWith(".rels")) return null;
  const directory = name.slice(0, marker);
  const sourceName = name.slice(marker + "/_rels/".length, -".rels".length);
  return sourceName ? `${directory}/${sourceName}` : null;
}

function resolveOpcTarget(sourcePart: string, target: string) {
  if (
    !target
    || target.includes("\\")
    || target.includes("\0")
    || target.includes("%")
    || target.includes("?")
    || target.includes("#")
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) return null;
  const parts = target.startsWith("/")
    ? []
    : sourcePart.split("/").slice(0, -1);
  for (const segment of target.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/").toLowerCase();
}

function isSafeOpenXml(bytes: Uint8Array, archive: ParsedZip, extension: string) {
  const identity = OPEN_XML_IDENTITIES[extension as keyof typeof OPEN_XML_IDENTITIES];
  if (!identity) return false;
  const metadata = new Map<string, Uint8Array>();
  let mainContents: Uint8Array | null = null;
  let inspectionBytes = 0;
  for (const entry of archive.entries.values()) {
    const lowerName = entry.name.toLowerCase();
    if (
      OPC_NAME_DANGER.test(lowerName)
      || (entry.name.endsWith("/") && entry.uncompressedSize !== 0)
    ) return false;
    const inspect = lowerName === identity.mainPart
      || lowerName === "[content_types].xml"
      || lowerName.endsWith(".rels");
    if (!inspect) continue;
    inspectionBytes += entry.uncompressedSize;
    if (inspectionBytes > OPC_INSPECTION_MAX_BYTES) return false;
    const contents = readZipEntry(bytes, entry);
    if (!contents) return false;
    if (lowerName === identity.mainPart) mainContents = contents;
    if (lowerName === "[content_types].xml" || lowerName.endsWith(".rels")) {
      if (contents.byteLength > OPC_METADATA_MAX_BYTES) return false;
      metadata.set(lowerName, contents);
    }
  }
  const contentTypeXml = metadata.get("[content_types].xml");
  const rootRelationshipsXml = metadata.get("_rels/.rels");
  const mainEntryName = archive.lowerNames.get(identity.mainPart);
  if (
    !contentTypeXml
    || !rootRelationshipsXml
    || !mainEntryName
    || !mainContents
    || !hasExpectedXmlRoot(mainContents, identity.rootName)
  ) return false;
  const mainEntry = archive.entries.get(mainEntryName)!;
  if (mainEntry.uncompressedSize < 1) return false;

  const contentTypeChildren = parseFlatOpcXml(
    contentTypeXml,
    "Types",
    OPC_CONTENT_TYPES_NAMESPACE,
    new Set(["Default", "Override"]),
  );
  if (!contentTypeChildren) return false;
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const child of contentTypeChildren) {
    if (child.name === "Default") {
      if (!exactAttributes(child.attributes, ["Extension", "ContentType"])) return false;
      const extensionName = child.attributes.get("Extension")!.toLowerCase();
      const contentType = child.attributes.get("ContentType")!.toLowerCase();
      if (
        !/^[a-z0-9]+$/.test(extensionName)
        || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
        || OPC_CONTENT_TYPE_DANGER.test(contentType)
        || defaults.has(extensionName)
      ) return false;
      defaults.set(extensionName, contentType);
    } else {
      if (!exactAttributes(child.attributes, ["PartName", "ContentType"])) return false;
      const partName = child.attributes.get("PartName")!;
      const contentType = child.attributes.get("ContentType")!.toLowerCase();
      const normalizedPart = partName.startsWith("/")
        ? partName.slice(1).toLowerCase()
        : "";
      if (
        !normalizedPart
        || partName.includes("%")
        || !archive.lowerNames.has(normalizedPart)
        || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
        || OPC_CONTENT_TYPE_DANGER.test(contentType)
        || overrides.has(normalizedPart)
      ) return false;
      overrides.set(normalizedPart, contentType);
    }
  }
  if (overrides.get(identity.mainPart) !== identity.contentType) return false;
  const identityCount = Object.values(OPEN_XML_IDENTITIES).filter((candidate) =>
    archive.lowerNames.has(candidate.mainPart)
    && overrides.get(candidate.mainPart) === candidate.contentType
  ).length;
  if (identityCount !== 1) return false;
  for (const lowerName of archive.lowerNames.keys()) {
    if (lowerName.endsWith("/") || lowerName === "[content_types].xml") continue;
    const extensionName = lowerName.includes(".") ? lowerName.split(".").at(-1)! : "";
    const contentType = overrides.get(lowerName) ?? defaults.get(extensionName);
    if (!contentType || OPC_CONTENT_TYPE_DANGER.test(contentType)) return false;
  }

  let rootOfficeDocumentCount = 0;
  for (const [relationshipName, relationshipXml] of metadata) {
    if (!relationshipName.endsWith(".rels")) continue;
    const sourcePart = relationshipSource(relationshipName);
    if (sourcePart === null) return false;
    const relationships = parseFlatOpcXml(
      relationshipXml,
      "Relationships",
      OPC_RELATIONSHIPS_NAMESPACE,
      new Set(["Relationship"]),
    );
    if (!relationships) return false;
    const ids = new Set<string>();
    for (const relationship of relationships) {
      if (!exactAttributes(
        relationship.attributes,
        ["Id", "Type", "Target"],
        ["TargetMode"],
      )) return false;
      const id = relationship.attributes.get("Id")!;
      const type = relationship.attributes.get("Type")!;
      const target = relationship.attributes.get("Target")!;
      const targetMode = relationship.attributes.get("TargetMode") ?? "Internal";
      if (!id || ids.has(id) || !/^https?:\/\//i.test(type) || OPC_RELATIONSHIP_DANGER.test(type)) {
        return false;
      }
      ids.add(id);
      if (targetMode.toLowerCase() === "external") {
        if (
          !/\/hyperlink$/i.test(type)
          || !/^(?:https?:|mailto:)/i.test(target)
        ) return false;
        continue;
      }
      if (targetMode.toLowerCase() !== "internal") return false;
      const resolved = resolveOpcTarget(sourcePart, target);
      if (!resolved || !archive.lowerNames.has(resolved)) return false;
      if (relationshipName === "_rels/.rels" && /\/officedocument$/i.test(type)) {
        rootOfficeDocumentCount += 1;
        if (resolved !== identity.mainPart) return false;
      }
    }
  }
  return rootOfficeDocumentCount === 1;
}

/**
 * Returns the canonical MIME only when signature, extension, and any declared
 * MIME agree. Office compound/ZIP containers are additionally constrained by
 * their extension because their leading magic is shared by several formats.
 */
export function sniffProjectMediaMime(
  bytes: Uint8Array,
  fileName: string,
  declaredMimeType: string,
): string | null {
  const extension = extensionOf(fileName);
  const expected = MIME_BY_EXTENSION[extension];
  const declared = declaredMimeType.trim().toLowerCase();
  if (!expected || (declared && declared !== expected)) return null;

  let detected: string | null = null;
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) detected = "image/jpeg";
  else if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = "image/png";
  } else if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    detected = "image/webp";
  } else if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) {
    detected = "image/gif";
  } else if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) {
    detected = "application/pdf";
  } else if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (["avif", "avis"].includes(brand)) detected = "image/avif";
    else if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      detected = expected === "image/heif" ? "image/heif" : "image/heic";
    }
  } else if (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])
    || hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06])
    || hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    const archive = parseZip(bytes);
    if (archive && isSafeOpenXml(bytes, archive, extension)) detected = expected;
  }
  return detected === expected ? detected : null;
}

export const PROJECT_MEDIA_MULTIPART_MAX_BYTES =
  PROJECT_MEDIA_MAX_BYTES + 64 * 1024;

export type ParsedProjectMediaMultipart = {
  fields: Record<string, string>;
  file: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  };
};

const PROJECT_MEDIA_MULTIPART_FIELDS = new Set([
  "phase",
  "caption",
  "documentId",
  "idempotencyKey",
]);

function projectMediaMultipartError(
  code = "PROJECT_MEDIA_MULTIPART_INVALID",
) {
  return new Error(code);
}

export async function parseProjectMediaMultipart(
  request: Request,
): Promise<ParsedProjectMediaMultipart> {
  if (!request.body) throw projectMediaMultipartError();
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > PROJECT_MEDIA_MULTIPART_MAX_BYTES
  ) throw projectMediaMultipartError("PROJECT_MEDIA_MULTIPART_TOO_LARGE");

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: {
        "content-type": request.headers.get("content-type") ?? "",
      },
      limits: {
        fileSize: PROJECT_MEDIA_MAX_BYTES,
        files: 1,
        fields: 4,
        fieldNameSize: 30,
        fieldSize: 2_000,
        parts: 5,
        headerPairs: 20,
      },
    });
  } catch {
    throw projectMediaMultipartError();
  }

  const source = Readable.fromWeb(request.body as never);
  let rawBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      rawBytes += chunk.length;
      callback(
        rawBytes > PROJECT_MEDIA_MULTIPART_MAX_BYTES
          ? projectMediaMultipartError("PROJECT_MEDIA_MULTIPART_TOO_LARGE")
          : null,
        chunk,
      );
    },
  });
  const fields: Record<string, string> = {};
  let parsedFile: ParsedProjectMediaMultipart["file"] | null = null;
  let validationError: Error | null = null;

  function invalidate(code?: string) {
    if (validationError) return;
    validationError = projectMediaMultipartError(code);
    source.destroy();
    limiter.destroy();
  }

  parser.on("field", (name, value, info) => {
    if (
      !PROJECT_MEDIA_MULTIPART_FIELDS.has(name)
      || Object.hasOwn(fields, name)
      || info.nameTruncated
      || info.valueTruncated
    ) {
      invalidate();
      return;
    }
    fields[name] = value;
  });
  parser.on("file", (name, file, info) => {
    file.on("error", () => undefined);
    if (name !== "file" || !info.filename || parsedFile) {
      file.resume();
      invalidate();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    file.on("limit", () => {
      truncated = true;
      invalidate("PROJECT_MEDIA_MULTIPART_TOO_LARGE");
    });
    file.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > PROJECT_MEDIA_MAX_BYTES) {
        truncated = true;
        invalidate("PROJECT_MEDIA_MULTIPART_TOO_LARGE");
        return;
      }
      chunks.push(chunk);
    });
    file.on("end", () => {
      if (truncated || validationError || size < 1) return;
      parsedFile = {
        fileName: info.filename,
        mimeType: info.mimeType,
        bytes: new Uint8Array(Buffer.concat(chunks, size)),
      };
    });
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) {
    parser.on(event, () => invalidate());
  }

  try {
    await pipeline(source, limiter, parser);
  } catch (error) {
    const candidate = validationError ?? error;
    if (
      candidate instanceof Error
      && (
        candidate.message === "PROJECT_MEDIA_MULTIPART_TOO_LARGE"
        || candidate.message === "PROJECT_MEDIA_MULTIPART_INVALID"
      )
    ) throw candidate;
    throw projectMediaMultipartError();
  } finally {
    if (!source.destroyed) source.destroy();
    if (!limiter.destroyed) limiter.destroy();
    if (!parser.destroyed) parser.destroy();
  }
  if (validationError) throw validationError;
  if (!Object.hasOwn(fields, "phase") || !parsedFile) {
    throw projectMediaMultipartError();
  }
  return { fields, file: parsedFile };
}

export class ProjectMediaError extends Error {
  constructor(
    readonly error: string,
    readonly status: number,
  ) {
    super(error);
    this.name = "ProjectMediaError";
  }
}

export class ProjectMediaRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProjectMediaRepositoryError";
  }
}

function isUniqueConstraintError(error: unknown) {
  let candidate = error;
  for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
    const record = candidate as { code?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    candidate = record.cause;
  }
  return false;
}

export type ProjectMediaInternalRecord = {
  id: string;
  mediaId: string;
  phase: ProjectMediaPhase;
  caption: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  provider: "r2" | "supabase";
  bucket: string;
  objectKey: string;
};

export type ProjectMediaDescriptor = Omit<
  ProjectMediaInternalRecord,
  "provider" | "bucket" | "objectKey"
> & { signedUrl: string };

export type ProjectAttachmentSummary = Omit<
  ProjectMediaInternalRecord,
  "provider" | "bucket" | "objectKey"
> & { documentIds: string[] };

export type ProjectMediaIdempotencyRecord = {
  record: ProjectMediaInternalRecord;
  documentIds: string[];
  sha256: string | null;
};

export type ProjectMediaUploadReservation = ProjectMediaIdempotencyRecord & {
  mediaStatus: "pending" | "ready";
};

function expectedDomain(purpose: MediaPurpose) {
  if (purpose === "project-document") return "projects";
  if (purpose === "service-evidence") return "service-evidence";
  if (purpose === "product-image") return "products";
  return "ai";
}

export async function requireReadyManagedMediaInTransaction(
  transaction: DatabaseLike,
  input: {
    storeId: string;
    mediaId: string;
    purpose: MediaPurpose;
    targetId: string;
    expectedPath: string;
    sha256?: string | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string;
    sizeBytes?: number;
    fileName?: string;
  },
): Promise<typeof mediaObjects.$inferSelect> {
  const coordinates = {
    storeId: canonicalizeUuidCoordinate(input.storeId),
    mediaId: canonicalizeUuidCoordinate(input.mediaId),
    targetId: canonicalizeUuidCoordinate(input.targetId),
  };
  const [media] = await transaction.select().from(mediaObjects).where(and(
    eq(mediaObjects.storeId, coordinates.storeId),
    eq(mediaObjects.id, coordinates.mediaId),
  )).limit(1).for("update");
  if (
    !media
    || media.provider !== "r2"
    || media.visibility !== "private"
    || media.status !== "ready"
    || media.deletedAt !== null
    || media.purpose !== input.purpose
    || !uuidCoordinatesEqual(media.targetId, coordinates.targetId)
    || media.domain !== expectedDomain(input.purpose)
    || media.objectKey !== input.expectedPath
    || (input.mimeType !== undefined && media.mimeType !== input.mimeType)
    || (input.sizeBytes !== undefined && media.sizeBytes !== input.sizeBytes)
    || (input.fileName !== undefined && media.originalFileName !== input.fileName)
    || (input.sha256 && media.sha256 && media.sha256 !== input.sha256)
    || (input.width !== undefined && input.width !== null && media.width !== null && media.width !== input.width)
    || (input.height !== undefined && input.height !== null && media.height !== null && media.height !== input.height)
  ) {
    throw new ProjectMediaRepositoryError("MANAGED_MEDIA_CONFLICT");
  }
  if (
    (input.sha256 && media.sha256 === null)
    || (input.width !== undefined && input.width !== null && media.width === null)
    || (input.height !== undefined && input.height !== null && media.height === null)
  ) {
    const [updated] = await transaction.update(mediaObjects).set({
      sha256: input.sha256 ?? media.sha256,
      width: input.width ?? media.width,
      height: input.height ?? media.height,
    }).where(and(
      eq(mediaObjects.storeId, coordinates.storeId),
      eq(mediaObjects.id, coordinates.mediaId),
      eq(mediaObjects.status, "ready"),
    )).returning();
    if (!updated) throw new ProjectMediaRepositoryError("MANAGED_MEDIA_CONFLICT");
    return updated;
  }
  return media;
}

export type ManagedMediaAssociationCompensationResult = Exclude<
  RecoverReadyMediaAfterFailureResult,
  { outcome: "conflict" }
>;

export async function compensateManagedMediaAssociation(
  database: DatabaseLike,
  input: {
    storeId: string;
    mediaId: string;
    purpose: MediaPurpose;
    targetId: string;
    expectedObjectKey: string;
    expectedCreatedBy: string | null;
    recoveredAt?: Date;
  },
): Promise<ManagedMediaAssociationCompensationResult> {
  const result = await recoverReadyMediaAfterFailureCore(database, {
    storeId: canonicalizeUuidCoordinate(input.storeId),
    mediaId: canonicalizeUuidCoordinate(input.mediaId),
    expectedPurpose: input.purpose,
    expectedTargetId: canonicalizeUuidCoordinate(input.targetId),
    expectedObjectKey: input.expectedObjectKey,
    expectedCreatedBy: canonicalizeNullableUuidCoordinate(input.expectedCreatedBy),
    recoveredAt: input.recoveredAt,
  });
  if (result.outcome === "conflict") {
    throw new ProjectMediaRepositoryError("MANAGED_MEDIA_RECOVERY_CONFLICT");
  }
  return result;
}

export function createDatabaseMediaRepository(
  database: DatabaseLike,
  options: { forceCreatedByNull?: boolean } = {},
): MediaRepository {
  return {
    async createPending(input: CreatePendingMediaInput) {
      const [row] = await database.insert(mediaObjects).values({
        ...input,
        id: canonicalizeUuidCoordinate(input.id),
        storeId: canonicalizeUuidCoordinate(input.storeId),
        targetId: canonicalizeUuidCoordinate(input.targetId),
        status: "pending",
        createdBy: options.forceCreatedByNull
          ? null
          : canonicalizeNullableUuidCoordinate(input.createdBy ?? null),
      }).returning();
      return row as MediaRecord;
    },
    async reservePending(input: CreatePendingMediaInput) {
      const values = {
        ...input,
        id: canonicalizeUuidCoordinate(input.id),
        storeId: canonicalizeUuidCoordinate(input.storeId),
        targetId: canonicalizeUuidCoordinate(input.targetId),
        status: "pending" as const,
        createdBy: options.forceCreatedByNull
          ? null
          : canonicalizeNullableUuidCoordinate(input.createdBy ?? null),
      };
      const [created] = await database.insert(mediaObjects).values(values)
        .onConflictDoNothing({ target: mediaObjects.id })
        .returning();
      if (created) {
        return { media: created as MediaRecord, created: true };
      }
      const [existing] = await database.select(mediaRecordWithMetadata).from(mediaObjects).where(and(
        eq(mediaObjects.storeId, values.storeId),
        eq(mediaObjects.id, values.id),
      )).limit(1);
      return existing
        ? { media: existing as MediaRecord, created: false }
        : null;
    },
    async getForStore(input: GetMediaForStoreInput) {
      const [row] = await database.select(mediaRecordWithMetadata).from(mediaObjects).where(and(
        eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
        eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
      )).limit(1);
      return (row as MediaRecord | undefined) ?? null;
    },
    async withReservedUploadLock<T>(
      input: GetMediaForStoreInput,
      operation: (lock: ReservedMediaUploadLock) => Promise<T>,
    ): Promise<T | null> {
      const coordinates = {
        storeId: canonicalizeUuidCoordinate(input.storeId),
        mediaId: canonicalizeUuidCoordinate(input.mediaId),
      };
      return database.transaction(async (transaction: DatabaseLike) => {
        const [media] = await transaction.select(mediaRecordWithMetadata).from(mediaObjects).where(and(
          eq(mediaObjects.storeId, coordinates.storeId),
          eq(mediaObjects.id, coordinates.mediaId),
        )).limit(1).for("update");
        if (!media) return null;
        return operation({
          media: media as MediaRecord,
          async markReady(value: Required<MarkMediaReadyInput>) {
            const [row] = await transaction.update(mediaObjects).set({
              status: "ready",
              sizeBytes: value.actualSizeBytes,
              readyAt: value.readyAt,
              verifiedAt: value.verifiedAt,
            }).where(and(
              eq(mediaObjects.storeId, canonicalizeUuidCoordinate(value.storeId)),
              eq(mediaObjects.id, canonicalizeUuidCoordinate(value.mediaId)),
              eq(mediaObjects.status, "pending"),
            )).returning();
            return (row as MediaRecord | undefined) ?? null;
          },
          async abandonPending(value: AbandonPendingMediaInput) {
            const [row] = await transaction.update(mediaObjects).set({
              status: "deleted",
              deletedAt: value.deletedAt,
            }).where(and(
              eq(mediaObjects.storeId, canonicalizeUuidCoordinate(value.storeId)),
              eq(mediaObjects.id, canonicalizeUuidCoordinate(value.mediaId)),
              eq(mediaObjects.status, "pending"),
              eq(mediaObjects.purpose, value.expectedPurpose),
              eq(mediaObjects.targetId, canonicalizeUuidCoordinate(value.expectedTargetId)),
            )).returning();
            return (row as MediaRecord | undefined) ?? null;
          },
          async quarantinePending(value: QuarantinePendingMediaInput) {
            const [row] = await transaction.update(mediaObjects).set({
              status: "quarantined",
              deletedAt: null,
            }).where(and(
              eq(mediaObjects.storeId, canonicalizeUuidCoordinate(value.storeId)),
              eq(mediaObjects.id, canonicalizeUuidCoordinate(value.mediaId)),
              eq(mediaObjects.status, "pending"),
              eq(mediaObjects.purpose, value.expectedPurpose),
              eq(mediaObjects.targetId, canonicalizeUuidCoordinate(value.expectedTargetId)),
            )).returning();
            return (row as MediaRecord | undefined) ?? null;
          },
        });
      });
    },
    async markReady(input: Required<MarkMediaReadyInput>) {
      const [row] = await database.update(mediaObjects).set({
        status: "ready",
        sizeBytes: input.actualSizeBytes,
        readyAt: input.readyAt,
        verifiedAt: input.verifiedAt,
      }).where(and(
        eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
        eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
        eq(mediaObjects.status, "pending"),
      )).returning();
      return (row as MediaRecord | undefined) ?? null;
    },
    async saveThumbnail(input: SaveMediaThumbnailInput) {
      const [row] = await database.update(mediaObjects).set({
        thumbnailObjectKey: input.objectKey,
        thumbnailSizeBytes: input.sizeBytes,
      }).where(and(
        eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
        eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
        eq(mediaObjects.status, "ready"),
      )).returning();
      return (row as MediaRecord | undefined) ?? null;
    },
    async saveMetadata(input: SaveMediaMetadataInput) {
      await database.execute(buildSaveMediaMetadataQuery(input));
      const [row] = await database.select(mediaRecordWithMetadata).from(mediaObjects).where(and(
        eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
        eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
      )).limit(1);
      return (row as MediaRecord | undefined) ?? null;
    },
    async abandonPending(input: AbandonPendingMediaInput) {
      const [row] = await database.update(mediaObjects).set({
        status: "deleted",
        deletedAt: input.deletedAt,
      }).where(and(
        eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
        eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
        eq(mediaObjects.status, "pending"),
        eq(mediaObjects.purpose, input.expectedPurpose),
        eq(mediaObjects.targetId, canonicalizeUuidCoordinate(input.expectedTargetId)),
      )).returning();
      return (row as MediaRecord | undefined) ?? null;
    },
    async quarantinePending(input: QuarantinePendingMediaInput) {
      const [row] = await database.update(mediaObjects).set({
        status: "quarantined",
        deletedAt: null,
      }).where(and(
        eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
        eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
        eq(mediaObjects.status, "pending"),
        eq(mediaObjects.purpose, input.expectedPurpose),
        eq(mediaObjects.targetId, canonicalizeUuidCoordinate(input.expectedTargetId)),
      )).returning();
      return (row as MediaRecord | undefined) ?? null;
    },
    recoverReadyAfterFailure(input) {
      return recoverReadyMediaAfterFailureCore(database, input);
    },
    softDeleteIfUnreferenced(input: Required<SoftDeleteMediaInput>) {
      return softDeleteMediaIfUnreferencedCore(database, input);
    },
  };
}

export async function resolveManagedPrivateMediaUrl(
  candidateActor: MediaActor,
  candidateMediaId: string,
  options: {
    expiresInSeconds?: number;
    expectedPurpose?: MediaPurpose;
    expectedTargetId?: string;
    database?: DatabaseLike;
    authorizeTarget?: AuthorizeMediaTarget;
    storageForProvider?: (provider: MediaProvider) => Pick<ObjectStorage, "createDownloadUrl">;
  } = {},
) {
  const database = options.database ?? db;
  const actor = canonicalizeMediaActor(candidateActor);
  const mediaId = canonicalizeUuidCoordinate(candidateMediaId);
  const expectedTargetId = options.expectedTargetId
    ? canonicalizeUuidCoordinate(options.expectedTargetId)
    : undefined;
  const [media] = await database.select().from(mediaObjects).where(and(
    eq(mediaObjects.storeId, actor.storeId),
    eq(mediaObjects.id, mediaId),
  )).limit(1);
  if (
    !media
    || media.status !== "ready"
    || media.deletedAt !== null
    || media.visibility !== "private"
    || (options.expectedPurpose && media.purpose !== options.expectedPurpose)
    || (expectedTargetId && !uuidCoordinatesEqual(media.targetId, expectedTargetId))
  ) throw new MediaServiceError("errors.notFound", 404);
  const authorization = await (options.authorizeTarget ?? authorizeMediaTarget)({
    actor,
    purpose: media.purpose,
    targetId: canonicalizeUuidCoordinate(media.targetId),
  });
  if (authorization !== "allowed") {
    throw new MediaServiceError("errors.notFound", 404);
  }
  return (options.storageForProvider ?? getObjectStorage)(media.provider).createDownloadUrl({
    bucket: media.bucket,
    key: media.objectKey,
    expiresInSeconds: options.expiresInSeconds ?? PROJECT_MEDIA_SIGNED_URL_SECONDS,
  });
}

export type ProjectMediaRepository = {
  listProjectAttachments(input: {
    storeId: string;
    projectId: string;
  }): Promise<ProjectMediaInternalRecord[]>;
  getProjectAttachment(input: {
    storeId: string;
    projectId: string;
    attachmentId: string;
  }): Promise<ProjectMediaIdempotencyRecord | null>;
  validateProjectDocument(input: {
    storeId: string;
    projectId: string;
    documentId: string;
  }): Promise<void>;
  reserveProjectAttachment(input: {
    storeId: string;
    actorId: string | null;
    projectId: string;
    mediaId: string;
    expectedPath: string;
    phase: ProjectMediaPhase;
    caption: string | null;
    documentId?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    idempotencyKey: string;
    createdAt?: Date;
  }): Promise<ProjectMediaUploadReservation>;
  createProjectAttachment(input: {
    storeId: string;
    actorId: string | null;
    projectId: string;
    mediaId: string;
    expectedPath: string;
    phase: ProjectMediaPhase;
    caption: string | null;
    documentId?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    idempotencyKey: string;
    createdAt?: Date;
  }): Promise<ProjectMediaInternalRecord>;
  cleanupTerminalProjectAttachmentReservation?(input: {
    storeId: string;
    projectId: string;
    mediaId: string;
    attachmentId: string;
    cleanedAt?: Date;
  }): Promise<{ outcome: "cleaned" | "retained" }>;
  deleteProjectAttachment(input: {
    storeId: string;
    actorId: string | null;
    projectId: string;
    attachmentId: string;
    deletedAt?: Date;
  }): Promise<{
    outcome: "deleted" | "already_deleted" | "referenced" | "not_found" | "conflict";
    id?: string;
  }>;
};

class ProjectMediaDeleteRollback extends Error {
  constructor(readonly outcome: "referenced" | "conflict") {
    super(`PROJECT_MEDIA_DELETE_${outcome.toUpperCase()}`);
  }
}

type ProjectMediaReplayInput = z.infer<typeof managerUploadSchema>;

function projectMediaReplayMatches(
  existing: ProjectMediaIdempotencyRecord,
  input: ProjectMediaReplayInput,
) {
  const expectedDocumentIds = input.documentId ? [input.documentId] : [];
  return existing.record.phase === input.phase
    && existing.record.caption === input.caption
    && existing.record.fileName === input.fileName
    && existing.record.mimeType === input.mimeType
    && existing.record.sizeBytes === input.sizeBytes
    && existing.sha256 === input.sha256
    && existing.documentIds.length === expectedDocumentIds.length
    && expectedDocumentIds.every((id) => existing.documentIds.includes(id));
}

function projectMediaReservationClientRequestId(
  attachmentId: string,
  documentId?: string,
) {
  return `project-upload:${attachmentId}:${documentId ?? "none"}`;
}

export function createDatabaseProjectMediaRepository(
  database: DatabaseLike,
): ProjectMediaRepository {
  return {
    async listProjectAttachments(input) {
      const storeId = canonicalizeUuidCoordinate(input.storeId);
      const projectId = canonicalizeUuidCoordinate(input.projectId);
      const rows = await database.select({
        id: serviceAttachments.id,
        mediaId: serviceAttachments.mediaObjectId,
        phase: serviceAttachments.projectPhase,
        caption: serviceAttachments.caption,
        fileName: serviceAttachments.fileName,
        mimeType: serviceAttachments.mimeType,
        sizeBytes: serviceAttachments.sizeBytes,
        createdAt: serviceAttachments.createdAt,
        provider: mediaObjects.provider,
        bucket: mediaObjects.bucket,
        objectKey: mediaObjects.objectKey,
      }).from(serviceAttachments).innerJoin(mediaObjects, and(
        eq(mediaObjects.storeId, serviceAttachments.storeId),
        eq(mediaObjects.id, serviceAttachments.mediaObjectId),
      )).where(and(
        eq(serviceAttachments.storeId, storeId),
        eq(serviceAttachments.projectId, projectId),
        isNull(serviceAttachments.jobId),
        isNull(serviceAttachments.claimId),
        isNull(serviceAttachments.assetId),
        isNull(serviceAttachments.requestId),
        isNull(serviceAttachments.deletedAt),
        eq(mediaObjects.storeId, storeId),
        eq(mediaObjects.status, "ready"),
        eq(mediaObjects.visibility, "private"),
        eq(mediaObjects.purpose, "project-document"),
        eq(mediaObjects.targetId, projectId),
        eq(mediaObjects.domain, "projects"),
        isNull(mediaObjects.deletedAt),
      )).orderBy(asc(serviceAttachments.createdAt), asc(serviceAttachments.id));
      return rows.map((row: typeof rows[number]) => ({
        ...row,
        mediaId: row.mediaId!,
        phase: row.phase ?? "other",
      }));
    },

    async getProjectAttachment(input) {
      const storeId = canonicalizeUuidCoordinate(input.storeId);
      const projectId = canonicalizeUuidCoordinate(input.projectId);
      const attachmentId = canonicalizeUuidCoordinate(input.attachmentId);
      const [row] = await database.select({
        id: serviceAttachments.id,
        mediaId: serviceAttachments.mediaObjectId,
        phase: serviceAttachments.projectPhase,
        caption: serviceAttachments.caption,
        fileName: serviceAttachments.fileName,
        mimeType: serviceAttachments.mimeType,
        sizeBytes: serviceAttachments.sizeBytes,
        sha256: serviceAttachments.sha256,
        createdAt: serviceAttachments.createdAt,
        provider: mediaObjects.provider,
        bucket: mediaObjects.bucket,
        objectKey: mediaObjects.objectKey,
      }).from(serviceAttachments).innerJoin(mediaObjects, and(
        eq(mediaObjects.storeId, serviceAttachments.storeId),
        eq(mediaObjects.id, serviceAttachments.mediaObjectId),
      )).where(and(
        eq(serviceAttachments.storeId, storeId),
        eq(serviceAttachments.projectId, projectId),
        eq(serviceAttachments.id, attachmentId),
        isNull(serviceAttachments.jobId),
        isNull(serviceAttachments.claimId),
        isNull(serviceAttachments.assetId),
        isNull(serviceAttachments.requestId),
        isNull(serviceAttachments.deletedAt),
        eq(mediaObjects.storeId, storeId),
        eq(mediaObjects.status, "ready"),
        eq(mediaObjects.visibility, "private"),
        eq(mediaObjects.purpose, "project-document"),
        eq(mediaObjects.targetId, projectId),
        eq(mediaObjects.domain, "projects"),
        isNull(mediaObjects.deletedAt),
      )).limit(1);
      if (!row?.mediaId) return null;
      const links = await database.select({
        documentId: serviceHandoverDocumentMedia.documentId,
      }).from(serviceHandoverDocumentMedia).innerJoin(
        serviceHandoverDocuments,
        and(
          eq(serviceHandoverDocuments.storeId, serviceHandoverDocumentMedia.storeId),
          eq(serviceHandoverDocuments.id, serviceHandoverDocumentMedia.documentId),
        ),
      ).where(and(
        eq(serviceHandoverDocumentMedia.storeId, storeId),
        eq(serviceHandoverDocumentMedia.mediaObjectId, row.mediaId),
        eq(serviceHandoverDocuments.projectId, projectId),
      ));
      return {
        record: {
          id: row.id,
          mediaId: row.mediaId,
          phase: row.phase ?? "other",
          caption: row.caption,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          createdAt: row.createdAt,
          provider: row.provider,
          bucket: row.bucket,
          objectKey: row.objectKey,
        },
        documentIds: links.map((link: { documentId: string }) => link.documentId),
        sha256: row.sha256,
      };
    },

    async validateProjectDocument(input) {
      const storeId = canonicalizeUuidCoordinate(input.storeId);
      const projectId = canonicalizeUuidCoordinate(input.projectId);
      const documentId = canonicalizeUuidCoordinate(input.documentId);
      const [document] = await database.select({ id: serviceHandoverDocuments.id })
        .from(serviceHandoverDocuments).where(and(
          eq(serviceHandoverDocuments.storeId, storeId),
          eq(serviceHandoverDocuments.id, documentId),
          eq(serviceHandoverDocuments.projectId, projectId),
        )).limit(1);
      if (!document) {
        throw new ProjectMediaRepositoryError("PROJECT_MEDIA_DOCUMENT_NOT_FOUND");
      }
    },

    async reserveProjectAttachment(input) {
      const coordinates = {
        storeId: canonicalizeUuidCoordinate(input.storeId),
        actorId: canonicalizeNullableUuidCoordinate(input.actorId),
        projectId: canonicalizeUuidCoordinate(input.projectId),
        mediaId: canonicalizeUuidCoordinate(input.mediaId),
        attachmentId: canonicalizeUuidCoordinate(input.idempotencyKey),
        documentId: input.documentId
          ? canonicalizeUuidCoordinate(input.documentId)
          : undefined,
      };
      try {
        return await database.transaction(async (transaction: DatabaseLike) => {
          const [project] = await transaction.select({ id: projects.id })
            .from(projects).where(and(
              eq(projects.storeId, coordinates.storeId),
              eq(projects.id, coordinates.projectId),
            )).limit(1).for("update");
          if (!project) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_PROJECT_NOT_FOUND");
          }
          if (coordinates.documentId) {
            const [document] = await transaction.select({ id: serviceHandoverDocuments.id })
              .from(serviceHandoverDocuments).where(and(
                eq(serviceHandoverDocuments.storeId, coordinates.storeId),
                eq(serviceHandoverDocuments.id, coordinates.documentId),
                eq(serviceHandoverDocuments.projectId, coordinates.projectId),
              )).limit(1).for("update");
            if (!document) {
              throw new ProjectMediaRepositoryError("PROJECT_MEDIA_DOCUMENT_NOT_FOUND");
            }
          }

          const [media] = await transaction.select().from(mediaObjects).where(and(
            eq(mediaObjects.storeId, coordinates.storeId),
            eq(mediaObjects.id, coordinates.mediaId),
          )).limit(1).for("update");
          if (
            !media
            || media.provider !== "r2"
            || media.visibility !== "private"
            || (media.status !== "pending" && media.status !== "ready")
            || media.deletedAt !== null
            || media.purpose !== "project-document"
            || !uuidCoordinatesEqual(media.targetId, coordinates.projectId)
            || media.domain !== "projects"
            || media.objectKey !== input.expectedPath
            || media.mimeType !== input.mimeType
            || media.sizeBytes !== input.sizeBytes
            || media.originalFileName !== input.fileName
            || media.sha256 !== input.sha256
            || !nullableUuidCoordinatesEqual(media.createdBy, coordinates.actorId)
          ) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
          }

          const [existing] = await transaction.select({
            id: serviceAttachments.id,
            mediaId: serviceAttachments.mediaObjectId,
            phase: serviceAttachments.projectPhase,
            caption: serviceAttachments.caption,
            fileName: serviceAttachments.fileName,
            mimeType: serviceAttachments.mimeType,
            sizeBytes: serviceAttachments.sizeBytes,
            sha256: serviceAttachments.sha256,
            clientRequestId: serviceAttachments.clientRequestId,
            createdAt: serviceAttachments.createdAt,
          }).from(serviceAttachments).where(and(
            eq(serviceAttachments.storeId, coordinates.storeId),
            eq(serviceAttachments.projectId, coordinates.projectId),
            eq(serviceAttachments.id, coordinates.attachmentId),
            isNull(serviceAttachments.jobId),
            isNull(serviceAttachments.claimId),
            isNull(serviceAttachments.assetId),
            isNull(serviceAttachments.requestId),
            isNull(serviceAttachments.deletedAt),
          )).limit(1);
          if (existing) {
            const links = !existing.mediaId ? [] : await transaction.select({
              documentId: serviceHandoverDocumentMedia.documentId,
            }).from(serviceHandoverDocumentMedia).innerJoin(
              serviceHandoverDocuments,
              and(
                eq(serviceHandoverDocuments.storeId, serviceHandoverDocumentMedia.storeId),
                eq(serviceHandoverDocuments.id, serviceHandoverDocumentMedia.documentId),
              ),
            ).where(and(
              eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
              eq(serviceHandoverDocumentMedia.mediaObjectId, existing.mediaId),
              eq(serviceHandoverDocuments.projectId, coordinates.projectId),
            ));
            const reservedDocumentIds = existing.mediaId
              ? links.map((link: { documentId: string }) => link.documentId)
              : existing.clientRequestId === projectMediaReservationClientRequestId(
                  coordinates.attachmentId,
                  coordinates.documentId,
                )
                ? coordinates.documentId ? [coordinates.documentId] : []
                : [];
            const replay = {
              record: {
                id: existing.id,
                mediaId: existing.mediaId ?? media.id,
                phase: existing.phase ?? "other",
                caption: existing.caption,
                fileName: existing.fileName,
                mimeType: existing.mimeType,
                sizeBytes: existing.sizeBytes,
                createdAt: existing.createdAt,
                provider: media.provider,
                bucket: media.bucket,
                objectKey: media.objectKey,
              },
              documentIds: reservedDocumentIds,
              sha256: existing.sha256,
            } satisfies ProjectMediaIdempotencyRecord;
            if (
              !projectMediaReplayMatches(replay, input)
              || (existing.mediaId === null
                && existing.clientRequestId !== projectMediaReservationClientRequestId(
                  coordinates.attachmentId,
                  coordinates.documentId,
                ))
              || (existing.mediaId !== null
                && !uuidCoordinatesEqual(existing.mediaId, coordinates.mediaId))
            ) {
              throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
            }
            return { ...replay, mediaStatus: media.status };
          }
          const [attachment] = await transaction.insert(serviceAttachments).values({
            id: coordinates.attachmentId,
            clientRequestId: projectMediaReservationClientRequestId(
              coordinates.attachmentId,
              coordinates.documentId,
            ),
            storeId: coordinates.storeId,
            projectId: coordinates.projectId,
            jobId: null,
            claimId: null,
            assetId: null,
            requestId: null,
            mediaObjectId: null,
            projectPhase: input.phase,
            category: "document",
            bucket: media.bucket,
            path: media.objectKey,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
            caption: input.caption,
            createdBy: coordinates.actorId,
            createdAt: input.createdAt,
          }).returning({
            id: serviceAttachments.id,
            phase: serviceAttachments.projectPhase,
            caption: serviceAttachments.caption,
            fileName: serviceAttachments.fileName,
            mimeType: serviceAttachments.mimeType,
            sizeBytes: serviceAttachments.sizeBytes,
            createdAt: serviceAttachments.createdAt,
          });
          if (!attachment) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
          }
          return {
            record: {
              ...attachment,
              mediaId: media.id,
              phase: attachment.phase ?? "other",
              provider: media.provider,
              bucket: media.bucket,
              objectKey: media.objectKey,
            },
            documentIds: coordinates.documentId ? [coordinates.documentId] : [],
            sha256: input.sha256,
            mediaStatus: media.status,
          };
        });
      } catch (error) {
        if (error instanceof ProjectMediaRepositoryError) throw error;
        if (isUniqueConstraintError(error)) {
          throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
        }
        throw error;
      }
    },

    async createProjectAttachment(input) {
      const coordinates = {
        storeId: canonicalizeUuidCoordinate(input.storeId),
        actorId: canonicalizeNullableUuidCoordinate(input.actorId),
        projectId: canonicalizeUuidCoordinate(input.projectId),
        mediaId: canonicalizeUuidCoordinate(input.mediaId),
        documentId: input.documentId
          ? canonicalizeUuidCoordinate(input.documentId)
          : undefined,
      };
      return database.transaction(async (transaction: DatabaseLike) => {
        const [project] = await transaction.select({ id: projects.id, name: projects.name })
          .from(projects).where(and(
            eq(projects.storeId, coordinates.storeId),
            eq(projects.id, coordinates.projectId),
          )).limit(1).for("update");
        if (!project) {
          throw new ProjectMediaRepositoryError("PROJECT_MEDIA_PROJECT_NOT_FOUND");
        }
        if (coordinates.documentId) {
          const [document] = await transaction.select({ id: serviceHandoverDocuments.id })
            .from(serviceHandoverDocuments).where(and(
              eq(serviceHandoverDocuments.storeId, coordinates.storeId),
              eq(serviceHandoverDocuments.id, coordinates.documentId),
              eq(serviceHandoverDocuments.projectId, coordinates.projectId),
            )).limit(1).for("update");
          if (!document) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_DOCUMENT_NOT_FOUND");
          }
        }
        const attachmentId = canonicalizeUuidCoordinate(input.idempotencyKey);
        const [reservation] = await transaction.select().from(serviceAttachments)
          .where(and(
            eq(serviceAttachments.storeId, coordinates.storeId),
            eq(serviceAttachments.projectId, coordinates.projectId),
            eq(serviceAttachments.id, attachmentId),
          )).limit(1).for("update");
        if (reservation && reservation.mediaObjectId === null) {
          const expectedRequestId = projectMediaReservationClientRequestId(
            attachmentId,
            coordinates.documentId,
          );
          if (
            reservation.jobId !== null
            || reservation.claimId !== null
            || reservation.assetId !== null
            || reservation.requestId !== null
            || reservation.deletedAt !== null
            || reservation.category !== "document"
            || reservation.projectPhase !== input.phase
            || reservation.caption !== input.caption
            || reservation.fileName !== input.fileName
            || reservation.mimeType !== input.mimeType
            || reservation.sizeBytes !== input.sizeBytes
            || reservation.sha256 !== input.sha256
            || reservation.clientRequestId !== expectedRequestId
            || !nullableUuidCoordinatesEqual(reservation.createdBy, coordinates.actorId)
          ) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
          }
          const media = await requireReadyManagedMediaInTransaction(transaction, {
            storeId: coordinates.storeId,
            mediaId: coordinates.mediaId,
            purpose: "project-document",
            targetId: coordinates.projectId,
            expectedPath: input.expectedPath,
            sha256: input.sha256,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            fileName: input.fileName,
          });
          const [attachment] = await transaction.update(serviceAttachments).set({
            mediaObjectId: media.id,
            clientRequestId: attachmentId,
            bucket: media.bucket,
            path: media.objectKey,
          }).where(and(
            eq(serviceAttachments.storeId, coordinates.storeId),
            eq(serviceAttachments.projectId, coordinates.projectId),
            eq(serviceAttachments.id, attachmentId),
            isNull(serviceAttachments.mediaObjectId),
            isNull(serviceAttachments.deletedAt),
          )).returning({
            id: serviceAttachments.id,
            phase: serviceAttachments.projectPhase,
            caption: serviceAttachments.caption,
            fileName: serviceAttachments.fileName,
            mimeType: serviceAttachments.mimeType,
            sizeBytes: serviceAttachments.sizeBytes,
            createdAt: serviceAttachments.createdAt,
          });
          if (!attachment) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
          }
          if (coordinates.documentId) {
            const [{ nextSortOrder }] = await transaction.select({
              nextSortOrder: sql<number>`coalesce(max(${serviceHandoverDocumentMedia.sortOrder}), -1) + 1`,
            }).from(serviceHandoverDocumentMedia).where(and(
              eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
              eq(serviceHandoverDocumentMedia.documentId, coordinates.documentId),
            ));
            await transaction.insert(serviceHandoverDocumentMedia).values({
              storeId: coordinates.storeId,
              documentId: coordinates.documentId,
              mediaObjectId: media.id,
              sortOrder: Number(nextSortOrder),
            });
          }
          await recordActivity(transaction, {
            storeId: coordinates.storeId, actorId: coordinates.actorId, action: "service.project.attachment.created", entityType: "service_attachment", entityId: attachment.id,
            after: { name: attachment.fileName, phase: attachment.phase, sizeBytes: attachment.sizeBytes, caption: attachment.caption },
            metadata: { projectId: coordinates.projectId, projectName: project.name, documentId: coordinates.documentId },
          });
          return {
            ...attachment,
            mediaId: media.id,
            phase: attachment.phase ?? "other",
            provider: media.provider,
            bucket: media.bucket,
            objectKey: media.objectKey,
          };
        }
        const [existing] = await transaction.select({
          id: serviceAttachments.id,
          mediaId: serviceAttachments.mediaObjectId,
          phase: serviceAttachments.projectPhase,
          caption: serviceAttachments.caption,
          fileName: serviceAttachments.fileName,
          mimeType: serviceAttachments.mimeType,
          sizeBytes: serviceAttachments.sizeBytes,
          sha256: serviceAttachments.sha256,
          createdAt: serviceAttachments.createdAt,
          provider: mediaObjects.provider,
          bucket: mediaObjects.bucket,
          objectKey: mediaObjects.objectKey,
        }).from(serviceAttachments).innerJoin(mediaObjects, and(
          eq(mediaObjects.storeId, serviceAttachments.storeId),
          eq(mediaObjects.id, serviceAttachments.mediaObjectId),
        )).where(and(
          eq(serviceAttachments.storeId, coordinates.storeId),
          eq(serviceAttachments.projectId, coordinates.projectId),
          eq(serviceAttachments.id, attachmentId),
          isNull(serviceAttachments.jobId),
          isNull(serviceAttachments.claimId),
          isNull(serviceAttachments.assetId),
          isNull(serviceAttachments.requestId),
          isNull(serviceAttachments.deletedAt),
          eq(mediaObjects.storeId, coordinates.storeId),
          eq(mediaObjects.status, "ready"),
          eq(mediaObjects.visibility, "private"),
          eq(mediaObjects.purpose, "project-document"),
          eq(mediaObjects.targetId, coordinates.projectId),
          eq(mediaObjects.domain, "projects"),
          isNull(mediaObjects.deletedAt),
        )).limit(1);
        if (existing?.mediaId) {
          const links = await transaction.select({
            documentId: serviceHandoverDocumentMedia.documentId,
          }).from(serviceHandoverDocumentMedia).innerJoin(
            serviceHandoverDocuments,
            and(
              eq(serviceHandoverDocuments.storeId, serviceHandoverDocumentMedia.storeId),
              eq(serviceHandoverDocuments.id, serviceHandoverDocumentMedia.documentId),
            ),
          ).where(and(
            eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
            eq(serviceHandoverDocumentMedia.mediaObjectId, existing.mediaId),
            eq(serviceHandoverDocuments.projectId, coordinates.projectId),
          ));
          const replay = {
            record: {
              id: existing.id,
              mediaId: existing.mediaId,
              phase: existing.phase ?? "other",
              caption: existing.caption,
              fileName: existing.fileName,
              mimeType: existing.mimeType,
              sizeBytes: existing.sizeBytes,
              createdAt: existing.createdAt,
              provider: existing.provider,
              bucket: existing.bucket,
              objectKey: existing.objectKey,
            },
            documentIds: links.map((link: { documentId: string }) => link.documentId),
            sha256: existing.sha256,
          } satisfies ProjectMediaIdempotencyRecord;
          if (!projectMediaReplayMatches(replay, input)) {
            throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
          }
          return replay.record;
        }
        const media = await requireReadyManagedMediaInTransaction(transaction, {
          storeId: coordinates.storeId,
          mediaId: coordinates.mediaId,
          purpose: "project-document",
          targetId: coordinates.projectId,
          expectedPath: input.expectedPath,
          sha256: input.sha256,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          fileName: input.fileName,
        });
        const [attachment] = await transaction.insert(serviceAttachments).values({
          id: canonicalizeUuidCoordinate(input.idempotencyKey),
          clientRequestId: canonicalizeUuidCoordinate(input.idempotencyKey),
          storeId: coordinates.storeId,
          projectId: coordinates.projectId,
          jobId: null,
          claimId: null,
          assetId: null,
          requestId: null,
          mediaObjectId: media.id,
          projectPhase: input.phase,
          category: "document",
          bucket: media.bucket,
          path: media.objectKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          caption: input.caption,
          createdBy: coordinates.actorId,
          createdAt: input.createdAt,
        }).returning({
          id: serviceAttachments.id,
          phase: serviceAttachments.projectPhase,
          caption: serviceAttachments.caption,
          fileName: serviceAttachments.fileName,
          mimeType: serviceAttachments.mimeType,
          sizeBytes: serviceAttachments.sizeBytes,
          createdAt: serviceAttachments.createdAt,
        });
        if (!attachment) {
          throw new ProjectMediaRepositoryError("PROJECT_MEDIA_ASSOCIATION_CONFLICT");
        }
        if (coordinates.documentId) {
          const [{ nextSortOrder }] = await transaction.select({
            nextSortOrder: sql<number>`coalesce(max(${serviceHandoverDocumentMedia.sortOrder}), -1) + 1`,
          }).from(serviceHandoverDocumentMedia).where(and(
            eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
            eq(serviceHandoverDocumentMedia.documentId, coordinates.documentId),
          ));
          await transaction.insert(serviceHandoverDocumentMedia).values({
            storeId: coordinates.storeId,
            documentId: coordinates.documentId,
            mediaObjectId: media.id,
            sortOrder: Number(nextSortOrder),
          });
        }
        await recordActivity(transaction, {
          storeId: coordinates.storeId, actorId: coordinates.actorId, action: "service.project.attachment.created", entityType: "service_attachment", entityId: attachment.id,
          after: { name: attachment.fileName, phase: attachment.phase, sizeBytes: attachment.sizeBytes, caption: attachment.caption },
          metadata: { projectId: coordinates.projectId, projectName: project.name, documentId: coordinates.documentId },
        });
        return {
          ...attachment,
          mediaId: media.id,
          phase: attachment.phase ?? "other",
          provider: media.provider,
          bucket: media.bucket,
          objectKey: media.objectKey,
        };
      });
    },

    cleanupTerminalProjectAttachmentReservation(input) {
      return cleanupTerminalProjectAttachmentReservation(database, input);
    },

    async deleteProjectAttachment(input) {
      const coordinates = {
        storeId: canonicalizeUuidCoordinate(input.storeId),
        actorId: canonicalizeNullableUuidCoordinate(input.actorId),
        projectId: canonicalizeUuidCoordinate(input.projectId),
        attachmentId: canonicalizeUuidCoordinate(input.attachmentId),
      };
      try {
        return await database.transaction(async (transaction: DatabaseLike) => {
          const [attachment] = await transaction.select().from(serviceAttachments)
            .where(and(
              eq(serviceAttachments.storeId, coordinates.storeId),
              eq(serviceAttachments.projectId, coordinates.projectId),
              eq(serviceAttachments.id, coordinates.attachmentId),
            )).limit(1).for("update");
          const projectLevel = attachment
            && attachment.jobId === null
            && attachment.claimId === null
            && attachment.assetId === null
            && attachment.requestId === null
            && attachment.mediaObjectId !== null;
          if (!projectLevel) return { outcome: "not_found" as const };
          if (attachment.deletedAt !== null) {
            return { outcome: "already_deleted" as const, id: attachment.id };
          }
          const documentLinks = await transaction.select({
            id: serviceHandoverDocumentMedia.id,
            projectId: serviceHandoverDocuments.projectId,
          }).from(serviceHandoverDocumentMedia).innerJoin(
            serviceHandoverDocuments,
            and(
              eq(serviceHandoverDocuments.storeId, serviceHandoverDocumentMedia.storeId),
              eq(serviceHandoverDocuments.id, serviceHandoverDocumentMedia.documentId),
            ),
          ).where(and(
            eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
            eq(serviceHandoverDocumentMedia.mediaObjectId, attachment.mediaObjectId!),
          ));
          if (documentLinks.some((link: { projectId: string }) =>
            !uuidCoordinatesEqual(link.projectId, coordinates.projectId)
          )) {
            throw new ProjectMediaDeleteRollback("conflict");
          }
          await transaction.delete(serviceHandoverDocumentMedia).where(and(
            eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
            eq(serviceHandoverDocumentMedia.mediaObjectId, attachment.mediaObjectId!),
          ));
          const [deletedAttachment] = await transaction.update(serviceAttachments).set({
            deletedAt: input.deletedAt ?? new Date(),
            deletedBy: coordinates.actorId,
          }).where(and(
            eq(serviceAttachments.storeId, coordinates.storeId),
            eq(serviceAttachments.id, attachment.id),
            isNull(serviceAttachments.deletedAt),
          )).returning({ id: serviceAttachments.id });
          if (!deletedAttachment) throw new ProjectMediaDeleteRollback("conflict");
          const mediaResult = await softDeleteMediaIfUnreferencedInTransaction(transaction, {
            storeId: coordinates.storeId,
            mediaId: attachment.mediaObjectId!,
            expectedPurpose: "project-document",
            expectedTargetId: coordinates.projectId,
            deletedAt: input.deletedAt,
          });
          if (mediaResult.outcome !== "deleted") {
            throw new ProjectMediaDeleteRollback(mediaResult.outcome);
          }
          const [project] = await transaction.select({ name: projects.name }).from(projects)
            .where(and(eq(projects.storeId, coordinates.storeId), eq(projects.id, coordinates.projectId))).limit(1);
          await recordActivity(transaction, {
            storeId: coordinates.storeId, actorId: coordinates.actorId, action: "service.project.attachment.deleted", entityType: "service_attachment", entityId: attachment.id,
            before: { name: attachment.fileName, phase: attachment.projectPhase, sizeBytes: attachment.sizeBytes, caption: attachment.caption },
            metadata: { projectId: coordinates.projectId, projectName: project?.name },
          });
          return { outcome: "deleted" as const, id: attachment.id };
        });
      } catch (error) {
        if (error instanceof ProjectMediaDeleteRollback) {
          return { outcome: error.outcome };
        }
        throw error;
      }
    },
  };
}

/**
 * Task 11 reconciliation hook. A pending reservation remains retryable even
 * after an ambiguous or definitive-no-write provider response. Reconciliation
 * must HEAD/verify that exact key first, then either complete it or move the
 * media row to a terminal state. Only the latter permits this hidden request
 * row to be soft-deleted; this function never removes a physical object.
 */
export async function cleanupTerminalProjectAttachmentReservation(
  database: DatabaseLike,
  input: {
    storeId: string;
    projectId: string;
    mediaId: string;
    attachmentId: string;
    cleanedAt?: Date;
  },
): Promise<{ outcome: "cleaned" | "retained" }> {
  const coordinates = {
    storeId: canonicalizeUuidCoordinate(input.storeId),
    projectId: canonicalizeUuidCoordinate(input.projectId),
    mediaId: canonicalizeUuidCoordinate(input.mediaId),
    attachmentId: canonicalizeUuidCoordinate(input.attachmentId),
  };
  if (!uuidCoordinatesEqual(coordinates.mediaId, coordinates.attachmentId)) {
    return { outcome: "retained" };
  }
  return database.transaction(async (transaction: DatabaseLike) => {
    const [media] = await transaction.select().from(mediaObjects).where(and(
      eq(mediaObjects.storeId, coordinates.storeId),
      eq(mediaObjects.id, coordinates.mediaId),
    )).limit(1).for("update");
    if (
      !media
      || (media.status !== "deleted" && media.status !== "quarantined")
      || media.purpose !== "project-document"
      || media.domain !== "projects"
      || !uuidCoordinatesEqual(media.targetId, coordinates.projectId)
    ) return { outcome: "retained" as const };

    const [reservation] = await transaction.select().from(serviceAttachments)
      .where(and(
        eq(serviceAttachments.storeId, coordinates.storeId),
        eq(serviceAttachments.projectId, coordinates.projectId),
        eq(serviceAttachments.id, coordinates.attachmentId),
      )).limit(1).for("update");
    const requestPrefix = `project-upload:${coordinates.attachmentId}:`;
    if (
      !reservation
      || reservation.mediaObjectId !== null
      || reservation.jobId !== null
      || reservation.claimId !== null
      || reservation.assetId !== null
      || reservation.requestId !== null
      || reservation.category !== "document"
      || !reservation.clientRequestId?.startsWith(requestPrefix)
    ) return { outcome: "retained" as const };
    if (reservation.deletedAt !== null) return { outcome: "cleaned" as const };

    const [cleaned] = await transaction.update(serviceAttachments).set({
      deletedAt: input.cleanedAt ?? new Date(),
    }).where(and(
      eq(serviceAttachments.storeId, coordinates.storeId),
      eq(serviceAttachments.projectId, coordinates.projectId),
      eq(serviceAttachments.id, coordinates.attachmentId),
      isNull(serviceAttachments.mediaObjectId),
      isNull(serviceAttachments.deletedAt),
    )).returning({ id: serviceAttachments.id });
    return { outcome: cleaned ? "cleaned" as const : "retained" as const };
  });
}

export async function listProjectAttachmentSummaries(
  database: DatabaseLike,
  input: { storeId: string; projectId: string },
): Promise<ProjectAttachmentSummary[]> {
  const coordinates = {
    storeId: canonicalizeUuidCoordinate(input.storeId),
    projectId: canonicalizeUuidCoordinate(input.projectId),
  };
  const rows = await createDatabaseProjectMediaRepository(database)
    .listProjectAttachments(coordinates);
  if (rows.length === 0) return [];
  const mediaIds = rows.map((row) => row.mediaId);
  const links = await database.select({
    mediaId: serviceHandoverDocumentMedia.mediaObjectId,
    documentId: serviceHandoverDocumentMedia.documentId,
  }).from(serviceHandoverDocumentMedia).innerJoin(
    serviceHandoverDocuments,
    and(
      eq(serviceHandoverDocuments.storeId, serviceHandoverDocumentMedia.storeId),
      eq(serviceHandoverDocuments.id, serviceHandoverDocumentMedia.documentId),
    ),
  ).where(and(
    eq(serviceHandoverDocumentMedia.storeId, coordinates.storeId),
    eq(serviceHandoverDocuments.projectId, coordinates.projectId),
    inArray(serviceHandoverDocumentMedia.mediaObjectId, mediaIds),
  )).orderBy(
    asc(serviceHandoverDocumentMedia.sortOrder),
    asc(serviceHandoverDocumentMedia.createdAt),
  );
  return rows.map((row) => ({
    id: row.id,
    mediaId: row.mediaId,
    phase: row.phase,
    caption: row.caption,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    documentIds: links
      .filter((link: { mediaId: string }) =>
        uuidCoordinatesEqual(link.mediaId, row.mediaId)
      )
      .map((link: { documentId: string }) => link.documentId),
  }));
}

export type ProjectMediaManager = ReturnType<typeof createProjectMediaManager>;

export function createProjectMediaManager(dependencies: {
  authorizeProject: (
    actor: MediaActor,
    projectId: string,
  ) => Promise<MediaTargetAuthorization>;
  repository: ProjectMediaRepository;
  mediaService: Pick<
    MediaService,
    "reserveManagedObject" | "putReservedManagedObject"
  >;
  sign: (
    record: ProjectMediaInternalRecord,
    expiresInSeconds: number,
    options?: { downloadFileName?: string },
  ) => Promise<string>;
  compensate: (input: {
    storeId: string;
    mediaId: string;
    purpose: "project-document";
    targetId: string;
    expectedObjectKey: string;
    expectedCreatedBy: string | null;
  }) => Promise<ManagedMediaAssociationCompensationResult>;
  logger?: Pick<Console, "error">;
}) {
  const logger = dependencies.logger ?? console;

  async function authorize(candidateActor: MediaActor, candidateProjectId: string) {
    const actor = canonicalizeMediaActor(candidateActor);
    const projectId = canonicalizeUuidCoordinate(candidateProjectId);
    const result = await dependencies.authorizeProject(actor, projectId);
    if (result === "allowed") return { actor, projectId };
    if (result === "not_found") throw new ProjectMediaError("errors.notFound", 404);
    throw new ProjectMediaError("errors.forbidden", 403);
  }

  async function descriptor(
    record: ProjectMediaInternalRecord,
    existingSignedUrl?: string,
  ) {
    const signedUrl = existingSignedUrl
      ?? await dependencies.sign(record, PROJECT_MEDIA_SIGNED_URL_SECONDS);
    return {
      id: record.id,
      mediaId: record.mediaId,
      phase: record.phase,
      caption: record.caption,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      createdAt: record.createdAt,
      signedUrl,
    } satisfies ProjectMediaDescriptor;
  }

  return {
    async list(actor: MediaActor, projectId: string) {
      const coordinates = await authorize(actor, projectId);
      const rows = await dependencies.repository.listProjectAttachments({
        storeId: coordinates.actor.storeId,
        projectId: coordinates.projectId,
      });
      return Promise.all(rows.map((record) => descriptor(record)));
    },

    async upload(
      actor: MediaActor,
      projectId: string,
      value: unknown,
      bytes: Uint8Array,
    ) {
      const coordinates = await authorize(actor, projectId);
      const parsed = managerUploadSchema.safeParse(value);
      if (!parsed.success || bytes.byteLength !== parsed.data.sizeBytes) {
        throw new ProjectMediaError("errors.invalidData", 400);
      }
      const input = parsed.data;
      if (input.documentId) {
        await dependencies.repository.validateProjectDocument({
          storeId: coordinates.actor.storeId,
          projectId: coordinates.projectId,
          documentId: input.documentId,
        });
      }
      const existing = await dependencies.repository.getProjectAttachment({
        storeId: coordinates.actor.storeId,
        projectId: coordinates.projectId,
        attachmentId: input.idempotencyKey,
      });
      if (existing) {
        if (!projectMediaReplayMatches(existing, input)) {
          throw new ProjectMediaError("media.associationConflict", 409);
        }
        return descriptor(existing.record);
      }
      const reservation = await dependencies.mediaService.reserveManagedObject(coordinates.actor, {
        reservationId: input.idempotencyKey,
        purpose: "project-document",
        targetId: coordinates.projectId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
      });
      try {
        await dependencies.repository.reserveProjectAttachment({
          storeId: coordinates.actor.storeId,
          actorId: coordinates.actor.userId,
          projectId: coordinates.projectId,
          mediaId: reservation.mediaId,
          expectedPath: reservation.path,
          phase: input.phase,
          caption: input.caption,
          documentId: input.documentId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (
          error instanceof ProjectMediaRepositoryError
          && error.code === "PROJECT_MEDIA_ASSOCIATION_CONFLICT"
        ) {
          throw new ProjectMediaError("media.associationConflict", 409);
        }
        throw error;
      }
      let uploaded: Awaited<ReturnType<MediaService["putReservedManagedObject"]>>;
      try {
        uploaded = await dependencies.mediaService.putReservedManagedObject(
          coordinates.actor,
          reservation.mediaId,
          bytes,
        );
      } catch (error) {
        if (
          error instanceof MediaServiceError
          && (error.status === 409 || error.status === 410)
          && dependencies.repository.cleanupTerminalProjectAttachmentReservation
        ) {
          try {
            await dependencies.repository.cleanupTerminalProjectAttachmentReservation({
              storeId: coordinates.actor.storeId,
              projectId: coordinates.projectId,
              mediaId: reservation.mediaId,
              attachmentId: input.idempotencyKey,
            });
          } catch (cleanupError) {
            logger.error("project media terminal reservation cleanup failed", {
              mediaId: reservation.mediaId,
              error: cleanupError,
            });
          }
        }
        throw error;
      }
      const mediaId = canonicalizeUuidCoordinate(uploaded.mediaId);
      let record: ProjectMediaInternalRecord;
      try {
        record = await dependencies.repository.createProjectAttachment({
          storeId: coordinates.actor.storeId,
          actorId: coordinates.actor.userId,
          projectId: coordinates.projectId,
          mediaId,
          expectedPath: uploaded.path,
          phase: input.phase,
          caption: input.caption,
          documentId: input.documentId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        let recovery: ManagedMediaAssociationCompensationResult;
        try {
          recovery = await dependencies.compensate({
            storeId: coordinates.actor.storeId,
            mediaId,
            purpose: "project-document",
            targetId: coordinates.projectId,
            expectedObjectKey: uploaded.path,
            expectedCreatedBy: coordinates.actor.userId,
          });
        } catch (compensationError) {
          logger.error("project media association compensation failed", {
            mediaId: uploaded.mediaId,
            error: compensationError,
          });
          throw compensationError;
        }
        if (
          recovery.outcome !== "referenced"
          && dependencies.repository.cleanupTerminalProjectAttachmentReservation
        ) {
          try {
            await dependencies.repository.cleanupTerminalProjectAttachmentReservation({
              storeId: coordinates.actor.storeId,
              projectId: coordinates.projectId,
              mediaId,
              attachmentId: input.idempotencyKey,
            });
          } catch (cleanupError) {
            logger.error("project media terminal reservation cleanup failed", {
              mediaId,
              error: cleanupError,
            });
          }
        }
        throw error;
      }
      if (!uuidCoordinatesEqual(record.mediaId, mediaId)) {
        await dependencies.compensate({
          storeId: coordinates.actor.storeId,
          mediaId,
          purpose: "project-document",
          targetId: coordinates.projectId,
          expectedObjectKey: uploaded.path,
          expectedCreatedBy: coordinates.actor.userId,
        });
        return descriptor(record);
      }
      // MediaService already produced a fresh private URL. Re-signing after the
      // association commit could turn a successful write into a retry/duplicate.
      return descriptor(record, uploaded.url);
    },

    async download(actor: MediaActor, projectId: string, attachmentId: string) {
      const coordinates = await authorize(actor, projectId);
      const canonicalAttachmentId = canonicalizeUuidCoordinate(attachmentId);
      const attachment = await dependencies.repository.getProjectAttachment({
        storeId: coordinates.actor.storeId,
        projectId: coordinates.projectId,
        attachmentId: canonicalAttachmentId,
      });
      if (!attachment) throw new ProjectMediaError("errors.notFound", 404);
      return {
        fileName: attachment.record.fileName,
        url: await dependencies.sign(
          attachment.record,
          PROJECT_MEDIA_SIGNED_URL_SECONDS,
          { downloadFileName: attachment.record.fileName },
        ),
      };
    },

    async delete(actor: MediaActor, projectId: string, attachmentId: string) {
      const coordinates = await authorize(actor, projectId);
      const canonicalAttachmentId = canonicalizeUuidCoordinate(attachmentId);
      const result = await dependencies.repository.deleteProjectAttachment({
        storeId: coordinates.actor.storeId,
        actorId: coordinates.actor.userId,
        projectId: coordinates.projectId,
        attachmentId: canonicalAttachmentId,
      });
      if (result.outcome === "not_found") {
        throw new ProjectMediaError("errors.notFound", 404);
      }
      if (result.outcome === "referenced") {
        throw new ProjectMediaError("media.referenced", 409);
      }
      if (result.outcome === "conflict") {
        throw new ProjectMediaError("media.deleteConflict", 409);
      }
      return {
        id: result.id ?? canonicalAttachmentId,
        status: result.outcome,
      };
    },
  };
}

let singleton: ProjectMediaManager | null = null;

export function getProjectMediaManager(): ProjectMediaManager {
  if (!singleton) {
    const repository = createDatabaseProjectMediaRepository(db);
    singleton = createProjectMediaManager({
      authorizeProject: (actor, projectId) => authorizeMediaTarget({
        actor,
        purpose: "project-document",
        targetId: projectId,
      }),
      repository,
      mediaService: getMediaService(),
      sign: (record, expiresInSeconds, options) => getObjectStorage(record.provider)
        .createDownloadUrl({
          bucket: record.bucket,
          key: record.objectKey,
          expiresInSeconds,
          downloadFileName: options?.downloadFileName,
        }),
      compensate: (input) => compensateManagedMediaAssociation(db, input),
    });
  }
  return singleton;
}

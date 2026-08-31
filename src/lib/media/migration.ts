import { createHash, randomUUID } from "node:crypto";

import type {
  MediaProvider,
  MediaVisibility,
  ObjectStorage,
} from "@/lib/media/types";
import type { MediaPurpose } from "@/lib/media/schemas";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export type MediaMigrationSourceProvider = MediaProvider | "external";

export type MediaMigrationStatus =
  | "inventoried"
  | "copied"
  | "verified"
  | "cutover"
  | "source_deleted"
  | "quarantined"
  | "skipped"
  | "failed"
  | "rolled_back";

export type MediaMigrationReference = {
  kind:
    | "product-image"
    | "brand-logo"
    | "service-attachment"
    | "customer-request-attachment"
    | "handover-photo"
    | "ai-attachment";
  recordId: string;
  index?: number;
};

export type MediaMigrationItem = {
  id: string;
  runId: string;
  storeId: string;
  sourceProvider: MediaMigrationSourceProvider;
  sourceBucket: string;
  sourceKey: string;
  targetBucket: string | null;
  targetKey: string | null;
  mediaObjectId: string | null;
  status: MediaMigrationStatus;
  purpose: MediaPurpose;
  targetId: string;
  domain: string;
  visibility: MediaVisibility;
  originalFileName: string;
  mimeType: string;
  references: MediaMigrationReference[];
  sourceSizeBytes: number | null;
  sourceSha256: string | null;
  targetSizeBytes: number | null;
  targetSha256: string | null;
  attempts: number;
  verifiedAt: Date | null;
  cutoverAt: Date | null;
  sourceDeletedAt: Date | null;
  lastError: string | null;
};

export type MediaMigrationInventoryInput = Pick<
  MediaMigrationItem,
  | "runId"
  | "storeId"
  | "sourceProvider"
  | "sourceBucket"
  | "sourceKey"
  | "purpose"
  | "targetId"
  | "domain"
  | "visibility"
  | "originalFileName"
  | "mimeType"
  | "references"
>;

export type ExternalMediaInventoryInput = Pick<
  MediaMigrationItem,
  | "runId"
  | "storeId"
  | "sourceBucket"
  | "sourceKey"
  | "purpose"
  | "targetId"
  | "domain"
  | "visibility"
  | "originalFileName"
  | "mimeType"
  | "references"
>;

export type SourceDeleteGate = {
  completedCutoverAt: Date | null;
  unresolvedItems: number;
  quarantinedItems: number;
  fallbackReads: number;
};

export interface MediaMigrationRepository {
  upsertInventoried(input: MediaMigrationItem): Promise<MediaMigrationItem>;
  getItem(id: string): Promise<MediaMigrationItem | null>;
  transition(input: {
    id: string;
    from: MediaMigrationStatus[];
    to: MediaMigrationStatus;
    patch?: Partial<MediaMigrationItem>;
  }): Promise<MediaMigrationItem>;
  cutoverItem(item: MediaMigrationItem): Promise<MediaMigrationItem>;
  rollbackItem(item: MediaMigrationItem): Promise<MediaMigrationItem>;
  getSourceDeleteGate(runId: string): Promise<SourceDeleteGate>;
}

export type LegacyUrlClassifierOptions = {
  allowedHosts: ReadonlySet<string>;
  allowedBuckets: ReadonlySet<string>;
};

export type LegacyObjectCoordinates = {
  provider: "supabase";
  bucket: string;
  key: string;
};

function decodeSafePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded
      || decoded === "."
      || decoded === ".."
      || decoded.includes("/")
      || decoded.includes("\\")
      || decoded.includes("\0")
      || decoded.includes("%")
    ) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function classifyLegacyUrl(
  value: string,
  options: LegacyUrlClassifierOptions,
): LegacyObjectCoordinates | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || !options.allowedHosts.has(url.hostname.toLowerCase())
  ) return null;

  const rawSegments = url.pathname.split("/").filter(Boolean);
  if (
    rawSegments.length < 6
    || rawSegments[0] !== "storage"
    || rawSegments[1] !== "v1"
    || rawSegments[2] !== "object"
    || !["public", "sign", "authenticated"].includes(rawSegments[3])
  ) return null;

  const bucket = decodeSafePathSegment(rawSegments[4]);
  const keySegments = rawSegments.slice(5).map(decodeSafePathSegment);
  if (
    !bucket
    || !options.allowedBuckets.has(bucket)
    || keySegments.some((segment) => segment == null)
  ) return null;
  const key = keySegments.join("/");
  return key ? { provider: "supabase", bucket, key } : null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createMigrationTargetKey(input: {
  storeId: string;
  domain: string;
  mediaId: string;
}): string {
  if (!UUID_PATTERN.test(input.storeId)) throw new Error("invalid_store_id");
  if (!UUID_PATTERN.test(input.mediaId)) throw new Error("invalid_media_id");
  if (!DOMAIN_PATTERN.test(input.domain)) throw new Error("invalid_media_domain");
  return [
    "stores",
    input.storeId.toLowerCase(),
    input.domain,
    "migration",
    input.mediaId.toLowerCase(),
    "original",
  ].join("/");
}

function requireItem(item: MediaMigrationItem | null): MediaMigrationItem {
  if (!item) throw new Error("migration_item_not_found");
  return item;
}

function targetBucketFor(
  configured: string | ((visibility: MediaVisibility) => string),
  visibility: MediaVisibility,
) {
  return typeof configured === "function" ? configured(visibility) : configured;
}

function alreadyCopied(status: MediaMigrationStatus) {
  return [
    "copied",
    "verified",
    "cutover",
    "source_deleted",
    "rolled_back",
  ].includes(status);
}

async function verifyExistingTarget(input: {
  storage: ObjectStorage;
  bucket: string;
  key: string;
  expectedBytes: Uint8Array;
}) {
  const head = await input.storage.head({
    bucket: input.bucket,
    key: input.key,
  });
  if (!head || head.sizeBytes !== input.expectedBytes.byteLength) return false;
  const targetBytes = await input.storage.get({
    bucket: input.bucket,
    key: input.key,
  });
  return sha256Hex(targetBytes) === sha256Hex(input.expectedBytes);
}

export function createMediaMigrationEngine(dependencies: {
  repository: MediaMigrationRepository;
  sourceStorage: ObjectStorage;
  targetStorage: ObjectStorage;
  targetBucket: string | ((visibility: MediaVisibility) => string);
  idFactory?: () => string;
  now?: () => Date;
}) {
  const idFactory = dependencies.idFactory ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  async function inventory(
    input: MediaMigrationInventoryInput,
  ): Promise<MediaMigrationItem> {
    if (input.sourceProvider !== "supabase") {
      throw new Error("unsupported_migration_source");
    }
    if (!input.sourceBucket.trim() || !input.sourceKey.trim()) {
      throw new Error("invalid_source_coordinates");
    }
    const id = idFactory();
    const targetBucket = targetBucketFor(
      dependencies.targetBucket,
      input.visibility,
    );
    return dependencies.repository.upsertInventoried({
      ...input,
      id,
      targetBucket,
      targetKey: createMigrationTargetKey({
        storeId: input.storeId,
        domain: input.domain,
        mediaId: id,
      }),
      mediaObjectId: null,
      status: "inventoried",
      sourceSizeBytes: null,
      sourceSha256: null,
      targetSizeBytes: null,
      targetSha256: null,
      attempts: 0,
      verifiedAt: null,
      cutoverAt: null,
      sourceDeletedAt: null,
      lastError: null,
    });
  }

  async function skipExternal(
    input: ExternalMediaInventoryInput,
  ): Promise<MediaMigrationItem> {
    const id = idFactory();
    return dependencies.repository.upsertInventoried({
      ...input,
      id,
      sourceProvider: "external",
      targetBucket: null,
      targetKey: null,
      mediaObjectId: null,
      status: "skipped",
      sourceSizeBytes: null,
      sourceSha256: null,
      targetSizeBytes: null,
      targetSha256: null,
      attempts: 0,
      verifiedAt: null,
      cutoverAt: null,
      sourceDeletedAt: null,
      lastError: "external_media_not_owned_by_luma",
    });
  }

  async function copy(id: string): Promise<MediaMigrationItem> {
    const item = requireItem(await dependencies.repository.getItem(id));
    if (alreadyCopied(item.status)) return item;
    if (item.status === "quarantined" || item.status === "skipped") return item;
    if (!["inventoried", "failed"].includes(item.status)) {
      throw new Error(`copy_invalid_status:${item.status}`);
    }
    if (!item.targetBucket || !item.targetKey) {
      throw new Error("migration_target_missing");
    }

    try {
      const sourceHead = await dependencies.sourceStorage.head({
        bucket: item.sourceBucket,
        key: item.sourceKey,
      });
      const bytes = await dependencies.sourceStorage.get({
        bucket: item.sourceBucket,
        key: item.sourceKey,
      });
      const sourceSha256 = sha256Hex(bytes);
      if (sourceHead && sourceHead.sizeBytes !== bytes.byteLength) {
        return dependencies.repository.transition({
          id: item.id,
          from: [item.status],
          to: "quarantined",
          patch: {
            sourceSizeBytes: bytes.byteLength,
            sourceSha256,
            attempts: item.attempts + 1,
            lastError: "source_size_mismatch",
          },
        });
      }
      const mimeType = sourceHead?.contentType?.split(";", 1)[0]?.trim().toLowerCase()
        || item.mimeType;
      const existing = await dependencies.targetStorage.head({
        bucket: item.targetBucket,
        key: item.targetKey,
      });
      if (existing) {
        const matches = await verifyExistingTarget({
          storage: dependencies.targetStorage,
          bucket: item.targetBucket,
          key: item.targetKey,
          expectedBytes: bytes,
        });
        if (!matches) {
          return dependencies.repository.transition({
            id: item.id,
            from: [item.status],
            to: "quarantined",
            patch: {
              sourceSizeBytes: bytes.byteLength,
              sourceSha256,
              targetSizeBytes: existing.sizeBytes,
              attempts: item.attempts + 1,
              lastError: "target_conflict",
            },
          });
        }
      } else {
        try {
          await dependencies.targetStorage.put({
            bucket: item.targetBucket,
            key: item.targetKey,
            body: bytes,
            contentType: mimeType,
            ifNoneMatch: "*",
          });
        } catch (error) {
          const reconciled = await verifyExistingTarget({
            storage: dependencies.targetStorage,
            bucket: item.targetBucket,
            key: item.targetKey,
            expectedBytes: bytes,
          }).catch(() => false);
          if (!reconciled) throw error;
        }
      }
      return dependencies.repository.transition({
        id: item.id,
        from: [item.status],
        to: "copied",
        patch: {
          sourceSizeBytes: bytes.byteLength,
          sourceSha256,
          targetSizeBytes: bytes.byteLength,
          targetSha256: sourceSha256,
          mimeType,
          attempts: item.attempts + 1,
          lastError: null,
        },
      });
    } catch (error) {
      return dependencies.repository.transition({
        id: item.id,
        from: [item.status],
        to: "failed",
        patch: {
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : "copy_failed",
        },
      });
    }
  }

  async function verify(id: string): Promise<MediaMigrationItem> {
    const item = requireItem(await dependencies.repository.getItem(id));
    if (["verified", "cutover", "source_deleted", "rolled_back"].includes(item.status)) {
      return item;
    }
    if (item.status !== "copied") {
      throw new Error(`verify_invalid_status:${item.status}`);
    }
    if (!item.targetBucket || !item.targetKey || !item.sourceSha256) {
      throw new Error("migration_target_missing");
    }
    const head = await dependencies.targetStorage.head({
      bucket: item.targetBucket,
      key: item.targetKey,
    });
    if (!head || head.sizeBytes !== item.sourceSizeBytes) {
      return dependencies.repository.transition({
        id: item.id,
        from: ["copied"],
        to: "quarantined",
        patch: {
          targetSizeBytes: head?.sizeBytes ?? null,
          lastError: "target_size_mismatch",
        },
      });
    }
    const targetContentType = head.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (targetContentType && targetContentType !== item.mimeType.toLowerCase()) {
      return dependencies.repository.transition({
        id: item.id,
        from: ["copied"],
        to: "quarantined",
        patch: {
          targetSizeBytes: head.sizeBytes,
          lastError: "target_mime_mismatch",
        },
      });
    }
    const targetBytes = await dependencies.targetStorage.get({
      bucket: item.targetBucket,
      key: item.targetKey,
    });
    const targetSha256 = sha256Hex(targetBytes);
    if (targetSha256 !== item.sourceSha256) {
      return dependencies.repository.transition({
        id: item.id,
        from: ["copied"],
        to: "quarantined",
        patch: {
          targetSizeBytes: targetBytes.byteLength,
          targetSha256,
          lastError: "target_hash_mismatch",
        },
      });
    }
    return dependencies.repository.transition({
      id: item.id,
      from: ["copied"],
      to: "verified",
      patch: {
        targetSizeBytes: targetBytes.byteLength,
        targetSha256,
        verifiedAt: now(),
        lastError: null,
      },
    });
  }

  async function cutover(id: string): Promise<MediaMigrationItem> {
    const item = requireItem(await dependencies.repository.getItem(id));
    if (["cutover", "source_deleted"].includes(item.status)) return item;
    if (item.status !== "verified") {
      throw new Error(`cutover_invalid_status:${item.status}`);
    }
    return dependencies.repository.cutoverItem(item);
  }

  async function rollback(id: string): Promise<MediaMigrationItem> {
    const item = requireItem(await dependencies.repository.getItem(id));
    if (item.status === "rolled_back") return item;
    if (item.status !== "cutover") {
      throw new Error(`rollback_invalid_status:${item.status}`);
    }
    return dependencies.repository.rollbackItem(item);
  }

  async function deleteSource(
    id: string,
    options: { confirmedAfter: Date },
  ): Promise<MediaMigrationItem> {
    const item = requireItem(await dependencies.repository.getItem(id));
    if (item.status === "source_deleted") return item;
    if (item.status !== "cutover") {
      throw new Error(`delete_source_invalid_status:${item.status}`);
    }
    const gate = await dependencies.repository.getSourceDeleteGate(item.runId);
    if (gate.fallbackReads > 0) throw new Error("fallback_reads_present");
    if (gate.quarantinedItems > 0) throw new Error("quarantined_items_present");
    if (gate.unresolvedItems > 0) throw new Error("unresolved_items_present");
    if (!gate.completedCutoverAt) throw new Error("cutover_not_completed");
    if (Number.isNaN(options.confirmedAfter.getTime())) {
      throw new Error("invalid_confirmation_timestamp");
    }
    if (options.confirmedAfter.getTime() > now().getTime()) {
      throw new Error("confirmation_timestamp_in_future");
    }
    if (
      options.confirmedAfter.getTime()
      < gate.completedCutoverAt.getTime() + RETENTION_MILLISECONDS
    ) throw new Error("retention_window_not_elapsed");

    await dependencies.sourceStorage.remove({
      bucket: item.sourceBucket,
      key: item.sourceKey,
    });
    return dependencies.repository.transition({
      id: item.id,
      from: ["cutover"],
      to: "source_deleted",
      patch: {
        sourceDeletedAt: now(),
        lastError: null,
      },
    });
  }

  return {
    inventory,
    skipExternal,
    copy,
    verify,
    cutover,
    rollback,
    deleteSource,
  };
}

import {
  and,
  eq,
  inArray,
  or,
} from "drizzle-orm";

import {
  mediaObjects,
  orders,
  projects,
  serviceAttachments,
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
  serviceCustomerRequestStorageCleanup,
  serviceHandoverDocumentMedia,
  serviceHandoverDocuments,
  serviceJobs,
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
  serviceSignatures,
} from "@/db/schema";
import { classifyLegacyUrl } from "@/lib/media/migration";
import {
  getLiveMediaReferenceStateInTransaction,
  softDeleteMediaIfUnreferencedInTransaction,
} from "@/lib/media/repository-core";
import { canonicalizeUuidCoordinate } from "@/lib/media/uuid-coordinate";

type DatabaseLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any

type LegacyObject = {
  bucket: string;
  path: string;
};

type ProjectMediaRow = typeof mediaObjects.$inferSelect;

export type DeleteProjectCoreResult =
  | {
      outcome: "deleted";
      projectId: string;
      managedMediaCount: number;
      legacyObjectCount: number;
    }
  | { outcome: "not_found" }
  | { outcome: "conflict"; reason: string };

export type DeleteProjectCoreInput = {
  storeId: string;
  projectId: string;
  actorId: string;
  deletedAt?: Date;
};

class ProjectDeletionConflict extends Error {}

const defaultLegacyBuckets = [
  "products",
  "service-evidence",
  "service-customer-request-evidence",
  "ai-attachments",
  "ai-pos-attachments",
  "luma-ai-attachments",
];

function configuredLegacyBuckets(additionalBuckets: string[]) {
  return Array.from(
    new Set([
      ...defaultLegacyBuckets,
      ...(process.env.LUMA_LEGACY_MEDIA_BUCKETS ?? "")
        .split(",")
        .map((bucket) => bucket.trim())
        .filter(Boolean),
      ...additionalBuckets.filter(Boolean),
    ]),
  );
}

function legacyMediaHosts() {
  return [
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        return [new URL(value).host];
      } catch {
        return [];
      }
    });
}

function addLegacyObject(
  objects: Map<string, LegacyObject>,
  bucket: string | null | undefined,
  path: string | null | undefined,
) {
  const normalizedBucket = bucket?.trim();
  const normalizedPath = path?.trim().replace(/^\/+/, "");
  if (!normalizedBucket || !normalizedPath) return;
  objects.set(`${normalizedBucket}\u0000${normalizedPath}`, {
    bucket: normalizedBucket,
    path: normalizedPath,
  });
}

function validateProjectMedia(
  media: ProjectMediaRow,
  projectId: string,
  jobIds: Set<string>,
) {
  const isProjectMedia =
    media.purpose === "project-document" && media.targetId === projectId;
  const isJobMedia =
    media.purpose === "service-evidence" && jobIds.has(media.targetId);

  if (!isProjectMedia && !isJobMedia) {
    throw new ProjectDeletionConflict(
      `Media ${media.id} is referenced by the project but owned by another target.`,
    );
  }
}

async function tombstoneProjectMedia(
  tx: DatabaseLike,
  storeId: string,
  projectId: string,
  jobIds: Set<string>,
  media: ProjectMediaRow,
  deletedAt: Date,
) {
  if (media.status === "deleted") return;

  if (media.status === "ready") {
    const result = await softDeleteMediaIfUnreferencedInTransaction(tx, {
      storeId,
      mediaId: media.id,
      expectedPurpose: media.purpose,
      expectedTargetId: media.targetId,
      deletedAt,
    });

    if (result.outcome !== "deleted") {
      throw new ProjectDeletionConflict(
        `Media ${media.id} is still referenced outside this project.`,
      );
    }
    return;
  }

  validateProjectMedia(media, projectId, jobIds);
  const liveReference = await getLiveMediaReferenceStateInTransaction(tx, {
    storeId,
    mediaId: media.id,
  });
  if (liveReference !== "none") {
    throw new ProjectDeletionConflict(
      `Media ${media.id} is still referenced outside this project.`,
    );
  }

  const [updated] = await tx
    .update(mediaObjects)
    .set({
      status: "deleted",
      deletedAt,
      cleanupClaimedAt: null,
      cleanupAttempts: 0,
      cleanupLastError: null,
    })
    .where(
      and(
        eq(mediaObjects.storeId, storeId),
        eq(mediaObjects.id, media.id),
        eq(mediaObjects.status, media.status),
      ),
    )
    .returning({ id: mediaObjects.id });

  if (!updated) {
    throw new ProjectDeletionConflict(
      `Media ${media.id} changed while the project was being deleted.`,
    );
  }
}

export async function deleteProjectCore(
  database: DatabaseLike,
  input: DeleteProjectCoreInput,
): Promise<DeleteProjectCoreResult> {
  const storeId = canonicalizeUuidCoordinate(input.storeId);
  const projectId = canonicalizeUuidCoordinate(input.projectId);
  canonicalizeUuidCoordinate(input.actorId);
  const deletedAt = input.deletedAt ?? new Date();

  try {
    return await database.transaction(async (tx: DatabaseLike) => {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.storeId, storeId), eq(projects.id, projectId)))
        .for("update")
        .limit(1);

      if (!project) return { outcome: "not_found" } as const;

      const jobs = await tx
        .select({ id: serviceJobs.id })
        .from(serviceJobs)
        .where(
          and(
            eq(serviceJobs.storeId, storeId),
            eq(serviceJobs.projectId, projectId),
          ),
        );
      const jobIdList: string[] = jobs.map((job: { id: string }) => job.id);
      const jobIds = new Set<string>(jobIdList);

      const requests = await tx
        .select({ id: serviceCustomerRequests.id })
        .from(serviceCustomerRequests)
        .where(
          and(
            eq(serviceCustomerRequests.storeId, storeId),
            eq(serviceCustomerRequests.projectId, projectId),
          ),
        );
      const requestIds = requests.map((request: { id: string }) => request.id);

      const handoverDocuments = await tx
        .select({
          id: serviceHandoverDocuments.id,
          photoUrls: serviceHandoverDocuments.photoUrls,
        })
        .from(serviceHandoverDocuments)
        .where(
          and(
            eq(serviceHandoverDocuments.storeId, storeId),
            eq(serviceHandoverDocuments.projectId, projectId),
          ),
        );
      const handoverDocumentIds = handoverDocuments.map(
        (document: { id: string }) => document.id,
      );

      const attachmentRows: Array<{
        mediaObjectId: string | null;
        bucket: string;
        path: string;
      }> = await tx
        .select({
          mediaObjectId: serviceAttachments.mediaObjectId,
          bucket: serviceAttachments.bucket,
          path: serviceAttachments.path,
        })
        .from(serviceAttachments)
        .where(
          and(
            eq(serviceAttachments.storeId, storeId),
            eq(serviceAttachments.projectId, projectId),
          ),
        );

      const requestAttachmentRows: Array<{
        mediaObjectId: string | null;
        bucket: string;
        path: string;
      }> = requestIds.length
        ? await tx
            .select({
              mediaObjectId: serviceCustomerRequestAttachments.mediaObjectId,
              bucket: serviceCustomerRequestAttachments.bucket,
              path: serviceCustomerRequestAttachments.path,
            })
            .from(serviceCustomerRequestAttachments)
            .where(
              and(
                eq(serviceCustomerRequestAttachments.storeId, storeId),
                inArray(
                  serviceCustomerRequestAttachments.requestId,
                  requestIds,
                ),
              ),
            )
        : [];

      const handoverMediaRows: Array<{ mediaObjectId: string }> =
        handoverDocumentIds.length
        ? await tx
            .select({ mediaObjectId: serviceHandoverDocumentMedia.mediaObjectId })
            .from(serviceHandoverDocumentMedia)
            .where(
              and(
                eq(serviceHandoverDocumentMedia.storeId, storeId),
                inArray(
                  serviceHandoverDocumentMedia.documentId,
                  handoverDocumentIds,
                ),
              ),
            )
        : [];

      const referencedMediaIds = Array.from(
        new Set(
          [...attachmentRows, ...requestAttachmentRows, ...handoverMediaRows]
            .map((row) => row.mediaObjectId)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const mediaPredicates = [
        and(
          eq(mediaObjects.purpose, "project-document"),
          eq(mediaObjects.targetId, projectId),
        ),
      ];
      if (jobIdList.length) {
        mediaPredicates.push(
          and(
            eq(mediaObjects.purpose, "service-evidence"),
            inArray(mediaObjects.targetId, jobIdList),
          ),
        );
      }
      if (referencedMediaIds.length) {
        mediaPredicates.push(inArray(mediaObjects.id, referencedMediaIds));
      }

      const managedMedia: ProjectMediaRow[] = await tx
        .select()
        .from(mediaObjects)
        .where(
          and(eq(mediaObjects.storeId, storeId), or(...mediaPredicates)),
        )
        .for("update");

      for (const media of managedMedia) {
        validateProjectMedia(media, projectId, jobIds);
      }

      const legacyObjects = new Map<string, LegacyObject>();
      for (const attachment of [
        ...attachmentRows,
        ...requestAttachmentRows,
      ]) {
        if (!attachment.mediaObjectId) {
          addLegacyObject(legacyObjects, attachment.bucket, attachment.path);
        }
      }

      const allowedBuckets = new Set(configuredLegacyBuckets([
        ...attachmentRows.map((row) => row.bucket),
        ...requestAttachmentRows.map((row) => row.bucket),
      ].filter((bucket): bucket is string => Boolean(bucket))));
      const allowedHosts = new Set(legacyMediaHosts());
      for (const document of handoverDocuments) {
        for (const rawUrl of document.photoUrls ?? []) {
          const classified = classifyLegacyUrl(rawUrl, {
            allowedHosts,
            allowedBuckets,
          });
          if (classified) {
            addLegacyObject(
              legacyObjects,
              classified.bucket,
              classified.key,
            );
          }
        }
      }

      const queuedObjects = new Map(legacyObjects);
      for (const media of managedMedia) {
        if (media.provider === "supabase") {
          addLegacyObject(queuedObjects, media.bucket, media.objectKey);
        }
      }

      const orderedQueuedObjects = Array.from(queuedObjects.values()).sort(
        (left, right) =>
          left.bucket.localeCompare(right.bucket) ||
          left.path.localeCompare(right.path),
      );
      if (orderedQueuedObjects.length) {
        await tx
          .insert(serviceCustomerRequestStorageCleanup)
          .values(
            orderedQueuedObjects.map((object) => ({
              storeId,
              requestId: null,
              bucket: object.bucket,
              path: object.path,
              notBefore: deletedAt,
            })),
          )
          .onConflictDoNothing({
            target: serviceCustomerRequestStorageCleanup.path,
          });
      }

      await tx
        .update(orders)
        .set({ projectId: null })
        .where(and(eq(orders.storeId, storeId), eq(orders.projectId, projectId)));

      // Terminal service records are intentionally immutable during normal
      // edits. Move them to an actionable state inside this same transaction
      // so their delete guards can allow the project-owned cascade. No
      // intermediate state can escape because the project is deleted before
      // the transaction commits.
      if (jobIdList.length) {
        await tx
          .update(serviceJobs)
          .set({ status: "in_progress" })
          .where(
            and(
              eq(serviceJobs.storeId, storeId),
              inArray(serviceJobs.id, jobIdList),
              or(
                eq(serviceJobs.status, "completed"),
                eq(serviceJobs.status, "cancelled"),
              ),
            ),
          );
      }

      await tx
        .delete(serviceSignatures)
        .where(
          and(
            eq(serviceSignatures.storeId, storeId),
            eq(serviceSignatures.projectId, projectId),
          ),
        );

      await tx
        .delete(serviceMaintenanceOccurrences)
        .where(
          and(
            eq(serviceMaintenanceOccurrences.storeId, storeId),
            inArray(
              serviceMaintenanceOccurrences.planId,
              tx
                .select({ id: serviceMaintenancePlans.id })
                .from(serviceMaintenancePlans)
                .where(
                  and(
                    eq(serviceMaintenancePlans.storeId, storeId),
                    eq(serviceMaintenancePlans.projectId, projectId),
                  ),
                ),
            ),
          ),
        );

      const [deletedProject] = await tx
        .delete(projects)
        .where(and(eq(projects.storeId, storeId), eq(projects.id, projectId)))
        .returning({ id: projects.id });
      if (!deletedProject) {
        throw new ProjectDeletionConflict(
          "The project changed while it was being deleted.",
        );
      }

      for (const media of managedMedia) {
        await tombstoneProjectMedia(
          tx,
          storeId,
          projectId,
          jobIds,
          media,
          deletedAt,
        );
      }

      return {
        outcome: "deleted",
        projectId,
        managedMediaCount: managedMedia.length,
        legacyObjectCount: legacyObjects.size,
      } as const;
    });
  } catch (error) {
    if (error instanceof ProjectDeletionConflict) {
      return { outcome: "conflict", reason: error.message };
    }
    throw error;
  }
}

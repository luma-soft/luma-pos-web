import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  installedAssets,
  projects,
  serviceAttachments,
  serviceFieldMutations,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobMaterials,
  serviceJobs,
  serviceSignatures,
  serviceStatusLogs,
  serviceTimeEntries,
  serviceVisits,
  warrantyClaims,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import { canAccessServiceJob } from "@/lib/services/access";
import {
  deriveServiceProjectStage,
  fieldCompletionErrors,
  type ServiceChecklistItem,
} from "@/lib/services/domain";
import {
  canonicalizeSignedDocument,
  hashSignedDocument,
  type JsonValue,
} from "@/lib/services/evidence";
import type {
  ServiceChecklistUpdateInput,
  ServiceCompletionInput,
  ServiceFieldAssetCreateInput,
  ServiceFieldMaterialUsageInput,
  ServiceSignatureInput,
  ServiceVisitMutationInput,
} from "@/lib/services/schemas";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

type FieldActor = { userId: string; role: Role };

async function requireAssignedJob(
  tx: ServiceTransaction,
  actor: FieldActor,
  jobId: string,
) {
  const [jobRows, crew] = await Promise.all([
    tx.select({
      id: serviceJobs.id,
      projectId: serviceJobs.projectId,
      serviceType: serviceJobs.serviceType,
      status: serviceJobs.status,
      assignedTo: serviceJobs.assignedTo,
      checklist: serviceJobs.checklist,
      projectStage: projects.serviceStage,
    }).from(serviceJobs)
      .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
      .where(eq(serviceJobs.id, jobId))
      .limit(1),
    tx.select({ profileId: serviceJobAssignments.profileId })
      .from(serviceJobAssignments)
      .where(and(
        eq(serviceJobAssignments.jobId, jobId),
        isNull(serviceJobAssignments.removedAt),
      )),
  ]);
  const job = jobRows[0];
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  if (!canAccessServiceJob({
    role: actor.role,
    profileId: actor.userId,
    primaryAssigneeId: job.assignedTo,
    crewProfileIds: crew.map((item) => item.profileId),
  })) throw new Error("SERVICE_JOB_FORBIDDEN");
  return job;
}

async function idempotentFieldMutation<T extends Record<string, unknown>>(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: { jobId: string; clientMutationId: string },
  operation: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const [claimed] = await tx.insert(serviceFieldMutations).values({
    actorId: actor.userId,
    jobId: input.jobId,
    clientMutationId: input.clientMutationId,
    operation,
  }).onConflictDoNothing({
    target: [
      serviceFieldMutations.actorId,
      serviceFieldMutations.clientMutationId,
    ],
  }).returning({ id: serviceFieldMutations.id });

  if (!claimed) {
    const [existing] = await tx.select({ result: serviceFieldMutations.result })
      .from(serviceFieldMutations)
      .where(and(
        eq(serviceFieldMutations.actorId, actor.userId),
        eq(serviceFieldMutations.clientMutationId, input.clientMutationId),
      ))
      .limit(1);
    if (!existing?.result) throw new Error("SERVICE_MUTATION_RETRY");
    return existing.result as T;
  }

  const result = await mutate();
  await tx.update(serviceFieldMutations)
    .set({ result })
    .where(eq(serviceFieldMutations.id, claimed.id));
  return result;
}

export async function checkInServiceVisitCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceVisitMutationInput,
  now = new Date(),
) {
  const job = await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "visit.check_in", async () => {
    const [visit] = await tx.insert(serviceVisits).values({
      jobId: input.jobId,
      profileId: actor.userId,
      status: "active",
      checkedInAt: now,
      checkInLatitude: input.latitude == null ? null : String(input.latitude),
      checkInLongitude: input.longitude == null ? null : String(input.longitude),
      note: input.note || null,
    }).returning({ id: serviceVisits.id });
    await tx.insert(serviceTimeEntries).values({
      jobId: input.jobId,
      visitId: visit.id,
      profileId: actor.userId,
      entryType: "work",
      startedAt: now,
    });
    if (job.status === "new" || job.status === "scheduled") {
      await tx.update(serviceJobs).set({
        status: "in_progress",
        updatedAt: now,
      }).where(eq(serviceJobs.id, input.jobId));
      await tx.insert(serviceStatusLogs).values({
        jobId: input.jobId,
        fromStatus: job.status,
        toStatus: "in_progress",
        note: input.note || null,
        createdBy: actor.userId,
      });
    }
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "visit.checked_in",
      actorId: actor.userId,
      payload: { visitId: visit.id },
      createdAt: now,
    });
    return { visitId: visit.id, status: "active" };
  });
}

export async function checkOutServiceVisitCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceVisitMutationInput,
  now = new Date(),
) {
  await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "visit.check_out", async () => {
    const [visit] = await tx.select({ id: serviceVisits.id })
      .from(serviceVisits)
      .where(and(
        eq(serviceVisits.jobId, input.jobId),
        eq(serviceVisits.profileId, actor.userId),
        eq(serviceVisits.status, "active"),
      ))
      .limit(1);
    if (!visit) throw new Error("SERVICE_ACTIVE_VISIT_NOT_FOUND");
    await tx.update(serviceVisits).set({
      status: "completed",
      checkedOutAt: now,
      checkOutLatitude: input.latitude == null ? null : String(input.latitude),
      checkOutLongitude: input.longitude == null ? null : String(input.longitude),
      note: input.note || null,
      updatedAt: now,
    }).where(eq(serviceVisits.id, visit.id));
    await tx.update(serviceTimeEntries).set({ endedAt: now })
      .where(and(
        eq(serviceTimeEntries.visitId, visit.id),
        isNull(serviceTimeEntries.endedAt),
      ));
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "visit.checked_out",
      actorId: actor.userId,
      payload: { visitId: visit.id },
      createdAt: now,
    });
    return { visitId: visit.id, status: "completed" };
  });
}

export async function updateFieldChecklistCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceChecklistUpdateInput,
  now = new Date(),
) {
  const job = await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.checklist", async () => {
    const submitted = new Map(input.checklist.map((item) => [item.code, item.completed]));
    if (
      submitted.size !== job.checklist.length
      || job.checklist.some((item) => !submitted.has(item.code))
    ) throw new Error("SERVICE_CHECKLIST_MISMATCH");
    const checklist: ServiceChecklistItem[] = job.checklist.map((item) => ({
      ...item,
      completed: submitted.get(item.code) ?? false,
    }));
    await tx.update(serviceJobs).set({ checklist, updatedAt: now })
      .where(eq(serviceJobs.id, input.jobId));
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "job.checklist_updated",
      actorId: actor.userId,
      payload: {
        completed: checklist.filter((item) => item.completed).length,
        total: checklist.length,
      },
      createdAt: now,
    });
    return {
      completed: checklist.filter((item) => item.completed).length,
      total: checklist.length,
    };
  });
}

export async function createServiceSignatureCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceSignatureInput,
  now = new Date(),
) {
  const job = await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.signature", async () => {
    const [attachment] = await tx.select({
      id: serviceAttachments.id,
      jobId: serviceAttachments.jobId,
      category: serviceAttachments.category,
      deletedAt: serviceAttachments.deletedAt,
    }).from(serviceAttachments)
      .where(eq(serviceAttachments.id, input.attachmentId))
      .limit(1);
    if (
      !attachment
      || attachment.jobId !== input.jobId
      || attachment.category !== "signature"
      || attachment.deletedAt
    ) throw new Error("SERVICE_SIGNATURE_ATTACHMENT_INVALID");
    const canonicalDocument = canonicalizeSignedDocument(input.document as JsonValue);
    const documentHash = hashSignedDocument(canonicalDocument);
    const [signature] = await tx.insert(serviceSignatures).values({
      projectId: job.projectId,
      jobId: input.jobId,
      documentId: input.documentId ?? null,
      attachmentId: input.attachmentId,
      signerName: input.signerName,
      signerRole: input.signerRole || null,
      documentHash,
      signedByProfileId: actor.userId,
      signedAt: now,
      evidence: { canonicalDocument },
    }).returning({ id: serviceSignatures.id });
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "job.signed",
      actorId: actor.userId,
      payload: { signatureId: signature.id, documentHash },
      createdAt: now,
    });
    return { signatureId: signature.id, documentHash, signedAt: now.toISOString() };
  });
}

export async function createFieldInstalledAssetCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceFieldAssetCreateInput,
  now = new Date(),
) {
  const job = await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.asset_created", async () => {
    const [asset] = await tx.insert(installedAssets).values({
      projectId: job.projectId,
      jobId: input.jobId,
      productId: input.productId ?? null,
      assetKind: input.assetKind,
      name: input.name,
      brand: input.brand || null,
      model: input.model || null,
      serialNumber: input.serialNumber || null,
      macAddress: input.macAddress || null,
      ipAddress: input.ipAddress || null,
      locationLabel: input.locationLabel || null,
      installedAt: input.installedAt ? new Date(input.installedAt) : now,
      customerWarrantyEndsOn: input.customerWarrantyEndsOn ?? null,
      supplierWarrantyEndsOn: input.supplierWarrantyEndsOn ?? null,
      note: input.note || null,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    }).returning({
      id: installedAssets.id,
      serialNumber: installedAssets.serialNumber,
      name: installedAssets.name,
    });
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "job.asset_created",
      actorId: actor.userId,
      payload: { assetId: asset.id, serialNumber: asset.serialNumber },
      createdAt: now,
    });
    return asset;
  });
}

export async function updateFieldMaterialUsageCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceFieldMaterialUsageInput,
  now = new Date(),
) {
  await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.material_usage", async () => {
    const [material] = await tx.update(serviceJobMaterials).set({
      usedQuantity: Number(input.usedQuantity).toFixed(4),
      note: input.note || null,
      updatedAt: now,
    }).where(and(
      eq(serviceJobMaterials.id, input.materialId),
      eq(serviceJobMaterials.jobId, input.jobId),
    )).returning({
      id: serviceJobMaterials.id,
      usedQuantity: serviceJobMaterials.usedQuantity,
    });
    if (!material) throw new Error("SERVICE_MATERIAL_NOT_FOUND");
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "job.material_usage_updated",
      actorId: actor.userId,
      payload: { materialId: material.id, usedQuantity: material.usedQuantity },
      createdAt: now,
    });
    return material;
  });
}

export async function completeFieldServiceJobCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceCompletionInput,
  now = new Date(),
) {
  const job = await requireAssignedJob(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.complete", async () => {
    const [attachments, signatures] = await Promise.all([
      tx.select({ category: serviceAttachments.category })
        .from(serviceAttachments)
        .where(and(
          eq(serviceAttachments.jobId, input.jobId),
          isNull(serviceAttachments.deletedAt),
        )),
      tx.select({ id: serviceSignatures.id })
        .from(serviceSignatures)
        .where(eq(serviceSignatures.jobId, input.jobId)),
    ]);
    const errors = fieldCompletionErrors({
      serviceType: job.serviceType,
      checklist: job.checklist,
      beforeEvidenceCount: attachments.filter((item) => item.category === "before").length,
      afterEvidenceCount: attachments.filter((item) => item.category === "after").length,
      signatureCount: signatures.length,
    });
    if (errors.length) throw new Error(`SERVICE_COMPLETION_INVALID:${errors.join(",")}`);
    if (job.status !== "in_progress" && job.status !== "warranty") {
      throw new Error("SERVICE_COMPLETION_STATUS_INVALID");
    }

    await tx.update(serviceJobs).set({
      status: "completed",
      completionNote: input.completionNote,
      completedAt: now,
      updatedAt: now,
    }).where(eq(serviceJobs.id, input.jobId));
    await tx.insert(serviceStatusLogs).values({
      jobId: input.jobId,
      fromStatus: job.status,
      toStatus: "completed",
      note: input.completionNote,
      createdBy: actor.userId,
      createdAt: now,
    });
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "job.completed",
      actorId: actor.userId,
      payload: { completionNote: input.completionNote },
      createdAt: now,
    });

    const [jobRows, claimRows] = await Promise.all([
      tx.select({ status: serviceJobs.status })
        .from(serviceJobs)
        .where(eq(serviceJobs.projectId, job.projectId)),
      tx.select({ status: warrantyClaims.status })
        .from(warrantyClaims)
        .where(eq(warrantyClaims.projectId, job.projectId)),
    ]);
    const countable = jobRows.filter((row) => row.status !== "cancelled");
    const completedCount = countable.filter((row) => row.status === "completed").length;
    await tx.update(projects).set({
      progressPercent: countable.length
        ? Math.round((completedCount / countable.length) * 100)
        : 0,
      serviceStage: deriveServiceProjectStage({
        fallbackStage: job.projectStage ?? "active",
        jobStatuses: jobRows.map((row) => row.status),
        warrantyClaimStatuses: claimRows.map((row) => row.status),
      }),
    }).where(eq(projects.id, job.projectId));
    return { jobId: input.jobId, status: "completed" };
  });
}

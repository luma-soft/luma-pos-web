import { and, asc, eq, isNull } from "drizzle-orm";
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
import { completeMaintenanceOccurrenceForJobCore } from "@/lib/services/maintenance-lifecycle";
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
const SERVICE_SIGNATURE_SNAPSHOT_VERSION = 1;

type SignedSnapshotIdentity = {
  signerName: string;
  signerRole: string | null;
  signedByProfileId: string;
  signedAt: Date;
};

async function buildAuthoritativeSignedSnapshot(
  tx: ServiceTransaction,
  jobId: string,
  identity: SignedSnapshotIdentity,
) {
  const jobRows = await tx.select({
      id: serviceJobs.id,
      projectId: serviceJobs.projectId,
      code: serviceJobs.code,
      serviceType: serviceJobs.serviceType,
      title: serviceJobs.title,
      description: serviceJobs.description,
      checklist: serviceJobs.checklist,
      projectName: projects.name,
      projectAddress: projects.address,
      projectServiceType: projects.serviceType,
      siteContactName: projects.siteContactName,
      siteContactPhone: projects.siteContactPhone,
    }).from(serviceJobs)
      .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
      .where(eq(serviceJobs.id, jobId))
      .limit(1)
      .for("update", { of: serviceJobs });
  const assets = await tx.select({
      id: installedAssets.id,
      projectId: installedAssets.projectId,
      jobId: installedAssets.jobId,
      productId: installedAssets.productId,
      assetKind: installedAssets.assetKind,
      name: installedAssets.name,
      brand: installedAssets.brand,
      model: installedAssets.model,
      serialNumber: installedAssets.serialNumber,
      macAddress: installedAssets.macAddress,
      ipAddress: installedAssets.ipAddress,
      locationLabel: installedAssets.locationLabel,
      installedAt: installedAssets.installedAt,
      customerWarrantyEndsOn: installedAssets.customerWarrantyEndsOn,
      supplierWarrantyEndsOn: installedAssets.supplierWarrantyEndsOn,
      status: installedAssets.status,
      note: installedAssets.note,
      createdAt: installedAssets.createdAt,
    }).from(installedAssets)
      .where(eq(installedAssets.jobId, jobId))
      .orderBy(asc(installedAssets.id));
  const attachments = await tx.select({
      id: serviceAttachments.id,
      category: serviceAttachments.category,
      fileName: serviceAttachments.fileName,
      mimeType: serviceAttachments.mimeType,
      sizeBytes: serviceAttachments.sizeBytes,
      sha256: serviceAttachments.sha256,
      caption: serviceAttachments.caption,
      createdAt: serviceAttachments.createdAt,
    }).from(serviceAttachments)
      .where(and(
        eq(serviceAttachments.jobId, jobId),
        isNull(serviceAttachments.deletedAt),
      ))
      .orderBy(asc(serviceAttachments.id));
  const job = jobRows[0];
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");

  return {
    schemaVersion: SERVICE_SIGNATURE_SNAPSHOT_VERSION,
    signedAt: identity.signedAt.toISOString(),
    signer: {
      name: identity.signerName,
      role: identity.signerRole,
      signedByProfileId: identity.signedByProfileId,
    },
    project: {
      id: job.projectId,
      name: job.projectName,
      address: job.projectAddress,
      serviceType: job.projectServiceType,
      siteContactName: job.siteContactName,
      siteContactPhone: job.siteContactPhone,
    },
    job: {
      id: job.id,
      code: job.code,
      serviceType: job.serviceType,
      title: job.title,
      description: job.description,
      checklist: job.checklist,
    },
    assets: assets.map((asset) => ({
      ...asset,
      installedAt: asset.installedAt?.toISOString() ?? null,
      createdAt: asset.createdAt.toISOString(),
    })),
    evidence: attachments.map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
}

function signedSnapshotOwnsSignature(
  snapshot: Record<string, unknown>,
  signature: {
    projectId: string;
    jobId: string;
    attachmentId: string;
    signerName: string;
    signerRole: string | null;
    signedByProfileId: string;
  },
) {
  const signer = snapshot.signer;
  const project = snapshot.project;
  const job = snapshot.job;
  const evidence = snapshot.evidence;
  if (
    !signer || typeof signer !== "object" || Array.isArray(signer)
    || !project || typeof project !== "object" || Array.isArray(project)
    || !job || typeof job !== "object" || Array.isArray(job)
    || !Array.isArray(evidence)
  ) return false;
  const signerRecord = signer as Record<string, unknown>;
  const projectRecord = project as Record<string, unknown>;
  const jobRecord = job as Record<string, unknown>;
  return (
    signerRecord.signedByProfileId === signature.signedByProfileId
    && signerRecord.name === signature.signerName
    && (signerRecord.role ?? null) === signature.signerRole
    && projectRecord.id === signature.projectId
    && jobRecord.id === signature.jobId
    && evidence.some((item) => (
      item
      && typeof item === "object"
      && !Array.isArray(item)
      && (item as Record<string, unknown>).id === signature.attachmentId
      && (item as Record<string, unknown>).category === "signature"
    ))
  );
}

async function requireAssignedJob(
  tx: ServiceTransaction,
  actor: FieldActor,
  jobId: string,
) {
  const jobRows = await tx.select({
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
      .limit(1);
  const crew = await tx.select({ profileId: serviceJobAssignments.profileId })
      .from(serviceJobAssignments)
      .where(and(
        eq(serviceJobAssignments.jobId, jobId),
        isNull(serviceJobAssignments.removedAt),
      ));
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

export async function requireLockedServiceJobAccess(
  tx: ServiceTransaction,
  actor: FieldActor,
  jobId: string,
) {
  const [job] = await tx.select({
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
    .limit(1)
    .for("update", { of: serviceJobs });
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  const crew = await tx.select({ profileId: serviceJobAssignments.profileId })
    .from(serviceJobAssignments)
    .where(and(
      eq(serviceJobAssignments.jobId, jobId),
      isNull(serviceJobAssignments.removedAt),
    ));
  if (!canAccessServiceJob({
    role: actor.role,
    profileId: actor.userId,
    primaryAssigneeId: job.assignedTo,
    crewProfileIds: crew.map((item) => item.profileId),
  })) throw new Error("SERVICE_JOB_FORBIDDEN");
  return job;
}

function requireFieldJobMutable(status: string) {
  if (status === "completed") {
    throw new Error("SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED");
  }
  if (status === "cancelled") {
    throw new Error("SERVICE_FIELD_JOB_TERMINAL");
  }
}

function requireCheckInStatus(status: string) {
  if (!["new", "scheduled", "in_progress", "warranty"].includes(status)) {
    throw new Error("SERVICE_VISIT_STATUS_INVALID");
  }
}

async function idempotentFieldMutation<T extends Record<string, unknown>>(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: { jobId: string; clientMutationId: string },
  operation: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const inputHash = hashSignedDocument(canonicalizeSignedDocument(
    JSON.parse(JSON.stringify(input)) as JsonValue,
  ));
  const [claimed] = await tx.insert(serviceFieldMutations).values({
    actorId: actor.userId,
    jobId: input.jobId,
    clientMutationId: input.clientMutationId,
    operation,
    inputHash,
  }).onConflictDoNothing({
    target: [
      serviceFieldMutations.actorId,
      serviceFieldMutations.clientMutationId,
    ],
  }).returning({ id: serviceFieldMutations.id });

  if (!claimed) {
    const [existing] = await tx.select({
      jobId: serviceFieldMutations.jobId,
      operation: serviceFieldMutations.operation,
      inputHash: serviceFieldMutations.inputHash,
      result: serviceFieldMutations.result,
    })
      .from(serviceFieldMutations)
      .where(and(
        eq(serviceFieldMutations.actorId, actor.userId),
        eq(serviceFieldMutations.clientMutationId, input.clientMutationId),
      ))
      .limit(1);
    if (
      existing
      && (existing.jobId !== input.jobId || existing.operation !== operation)
    ) throw new Error("SERVICE_MUTATION_ID_CONFLICT");
    if (existing?.inputHash && existing.inputHash !== inputHash) {
      throw new Error("SERVICE_MUTATION_PAYLOAD_CONFLICT");
    }
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
  const job = await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "visit.check_in", async () => {
    requireCheckInStatus(job.status);
    const [visit] = await tx.insert(serviceVisits).values({
      jobId: input.jobId,
      profileId: actor.userId,
      status: "active",
      checkedInAt: now,
      checkInLatitude: input.latitude == null ? null : String(input.latitude),
      checkInLongitude: input.longitude == null ? null : String(input.longitude),
      note: input.note || null,
    }).onConflictDoNothing().returning({ id: serviceVisits.id });
    if (!visit) throw new Error("SERVICE_ACTIVE_VISIT_EXISTS");
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
  await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "visit.check_out", async () => {
    const [visit] = await tx.select({ id: serviceVisits.id })
      .from(serviceVisits)
      .where(and(
        eq(serviceVisits.jobId, input.jobId),
        eq(serviceVisits.profileId, actor.userId),
        eq(serviceVisits.status, "active"),
      ))
      .limit(1)
      .for("update");
    if (!visit) throw new Error("SERVICE_ACTIVE_VISIT_NOT_FOUND");
    await tx.update(serviceVisits).set({
      status: "completed",
      checkedOutAt: now,
      checkOutLatitude: input.latitude == null ? null : String(input.latitude),
      checkOutLongitude: input.longitude == null ? null : String(input.longitude),
      note: input.note || null,
      updatedAt: now,
    }).where(eq(serviceVisits.id, visit.id));
    const [timeEntry] = await tx.update(serviceTimeEntries).set({ endedAt: now })
      .where(and(
        eq(serviceTimeEntries.visitId, visit.id),
        eq(serviceTimeEntries.jobId, input.jobId),
        eq(serviceTimeEntries.profileId, actor.userId),
        eq(serviceTimeEntries.entryType, "work"),
        isNull(serviceTimeEntries.endedAt),
      ))
      .returning({ id: serviceTimeEntries.id });
    if (!timeEntry) throw new Error("SERVICE_ACTIVE_TIME_ENTRY_NOT_FOUND");
    await tx.insert(serviceJobEvents).values({
      jobId: input.jobId,
      eventType: "visit.checked_out",
      actorId: actor.userId,
      payload: { visitId: visit.id },
      createdAt: now,
    });
    return { visitId: visit.id, timeEntryId: timeEntry.id, status: "completed" };
  });
}

export async function updateFieldChecklistCore(
  tx: ServiceTransaction,
  actor: FieldActor,
  input: ServiceChecklistUpdateInput,
  now = new Date(),
) {
  const job = await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.checklist", async () => {
    requireFieldJobMutable(job.status);
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
  await requireAssignedJob(tx, actor, input.jobId);
  const [attachment] = await tx.select({
      id: serviceAttachments.id,
      jobId: serviceAttachments.jobId,
      category: serviceAttachments.category,
      deletedAt: serviceAttachments.deletedAt,
    }).from(serviceAttachments)
      .where(eq(serviceAttachments.id, input.attachmentId))
      .limit(1)
      .for("update");
  if (
    !attachment
    || attachment.jobId !== input.jobId
    || attachment.category !== "signature"
    || attachment.deletedAt
  ) throw new Error("SERVICE_SIGNATURE_ATTACHMENT_INVALID");
  const job = await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.signature", async () => {
    const snapshot = await buildAuthoritativeSignedSnapshot(tx, input.jobId, {
      signerName: input.signerName,
      signerRole: input.signerRole || null,
      signedByProfileId: actor.userId,
      signedAt: now,
    });
    const canonicalDocument = canonicalizeSignedDocument(snapshot as JsonValue);
    const documentHash = hashSignedDocument(canonicalDocument);
    await tx.update(serviceSignatures).set({
      invalidatedAt: now,
      invalidatedBy: actor.userId,
      invalidationReason: "signature.superseded",
    }).where(and(
      eq(serviceSignatures.jobId, input.jobId),
      isNull(serviceSignatures.invalidatedAt),
    ));
    const [signature] = await tx.insert(serviceSignatures).values({
      projectId: job.projectId,
      jobId: input.jobId,
      documentId: null,
      attachmentId: input.attachmentId,
      signerName: input.signerName,
      signerRole: input.signerRole || null,
      documentHash,
      canonicalSnapshot: JSON.parse(canonicalDocument) as Record<string, unknown>,
      snapshotSchemaVersion: SERVICE_SIGNATURE_SNAPSHOT_VERSION,
      signedByProfileId: actor.userId,
      signedAt: now,
      evidence: { source: "authoritative-server-snapshot" },
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
  const job = await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.asset_created", async () => {
    requireFieldJobMutable(job.status);
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
  const job = await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.material_usage", async () => {
    requireFieldJobMutable(job.status);
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
  const job = await requireLockedServiceJobAccess(tx, actor, input.jobId);
  return idempotentFieldMutation(tx, actor, input, "job.complete", async () => {
    if (job.status !== "in_progress" && job.status !== "warranty") {
      throw new Error("SERVICE_COMPLETION_STATUS_INVALID");
    }
    const openVisit = await tx.select({ id: serviceVisits.id })
        .from(serviceVisits)
        .where(and(
          eq(serviceVisits.jobId, input.jobId),
          eq(serviceVisits.status, "active"),
        ))
        .limit(1)
        .for("update");
    const openTimeEntry = await tx.select({ id: serviceTimeEntries.id })
        .from(serviceTimeEntries)
        .where(and(
          eq(serviceTimeEntries.jobId, input.jobId),
          isNull(serviceTimeEntries.endedAt),
        ))
        .limit(1)
        .for("update");
    if (openVisit[0] || openTimeEntry[0]) {
      throw new Error("SERVICE_COMPLETION_OPEN_WORK");
    }
    const attachments = await tx.select({ category: serviceAttachments.category })
        .from(serviceAttachments)
        .where(and(
          eq(serviceAttachments.jobId, input.jobId),
          isNull(serviceAttachments.deletedAt),
        ));
    const signatures = await tx.select({
        id: serviceSignatures.id,
        projectId: serviceSignatures.projectId,
        jobId: serviceSignatures.jobId,
        attachmentId: serviceSignatures.attachmentId,
        signerName: serviceSignatures.signerName,
        signerRole: serviceSignatures.signerRole,
        documentHash: serviceSignatures.documentHash,
        canonicalSnapshot: serviceSignatures.canonicalSnapshot,
        snapshotSchemaVersion: serviceSignatures.snapshotSchemaVersion,
        signedByProfileId: serviceSignatures.signedByProfileId,
        signedAt: serviceSignatures.signedAt,
        invalidatedAt: serviceSignatures.invalidatedAt,
        attachmentProjectId: serviceAttachments.projectId,
        attachmentJobId: serviceAttachments.jobId,
        attachmentDeletedAt: serviceAttachments.deletedAt,
      })
        .from(serviceSignatures)
        .innerJoin(serviceAttachments, eq(serviceSignatures.attachmentId, serviceAttachments.id))
        .where(eq(serviceSignatures.jobId, input.jobId));
    const errors = fieldCompletionErrors({
      serviceType: job.serviceType,
      checklist: job.checklist,
      beforeEvidenceCount: attachments.filter((item) => item.category === "before").length,
      afterEvidenceCount: attachments.filter((item) => item.category === "after").length,
      signatureCount: signatures.length,
    });
    if (errors.length) throw new Error(`SERVICE_COMPLETION_INVALID:${errors.join(",")}`);
    const signature = signatures
      .filter((item) => !item.invalidatedAt)
      .sort((left, right) => right.signedAt.getTime() - left.signedAt.getTime())[0];
    if (!signature) throw new Error("SERVICE_SIGNATURE_STALE");
    if (
      signature.projectId !== job.projectId
      || signature.jobId !== input.jobId
      || signature.attachmentProjectId !== job.projectId
      || signature.attachmentJobId !== input.jobId
      || signature.attachmentDeletedAt
      || !signature.signedByProfileId
    ) throw new Error("SERVICE_SIGNATURE_OWNERSHIP_INVALID");
    if (
      signature.snapshotSchemaVersion !== SERVICE_SIGNATURE_SNAPSHOT_VERSION
      || !signature.canonicalSnapshot
    ) throw new Error("SERVICE_SIGNATURE_STALE");
    if (!signedSnapshotOwnsSignature(signature.canonicalSnapshot, {
      projectId: signature.projectId,
      jobId: signature.jobId,
      attachmentId: signature.attachmentId,
      signerName: signature.signerName,
      signerRole: signature.signerRole,
      signedByProfileId: signature.signedByProfileId,
    })) throw new Error("SERVICE_SIGNATURE_OWNERSHIP_INVALID");
    const persistedCanonical = canonicalizeSignedDocument(
      signature.canonicalSnapshot as JsonValue,
    );
    if (hashSignedDocument(persistedCanonical) !== signature.documentHash) {
      throw new Error("SERVICE_SIGNATURE_HASH_INVALID");
    }
    const currentSnapshot = await buildAuthoritativeSignedSnapshot(tx, input.jobId, {
      signerName: signature.signerName,
      signerRole: signature.signerRole,
      signedByProfileId: signature.signedByProfileId,
      signedAt: signature.signedAt,
    });
    if (
      hashSignedDocument(canonicalizeSignedDocument(currentSnapshot as JsonValue))
      !== signature.documentHash
    ) throw new Error("SERVICE_SIGNATURE_STALE");

    await tx.update(serviceJobs).set({
      status: "completed",
      completionNote: input.completionNote,
      completedAt: now,
      updatedAt: now,
    }).where(eq(serviceJobs.id, input.jobId));
    await completeMaintenanceOccurrenceForJobCore(tx, input.jobId, now);
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

    const jobRows = await tx.select({ status: serviceJobs.status })
        .from(serviceJobs)
        .where(eq(serviceJobs.projectId, job.projectId));
    const claimRows = await tx.select({ status: warrantyClaims.status })
        .from(warrantyClaims)
        .where(eq(warrantyClaims.projectId, job.projectId));
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

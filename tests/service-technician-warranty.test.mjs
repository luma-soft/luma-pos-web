import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const warranty = await import(
  `${projectRoot}/src/lib/services/technician-warranty.ts`
).catch(() => ({}));
const {
  auditLogs,
  installedAssets,
  profiles,
  projects,
  serviceAttachments,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
  serviceCustomerRequestStorageCleanup,
  warrantyClaimNotifications,
} = schema;
const {
  createTechnicianWarrantyClaimCore,
  finalizeTechnicianWarrantyClaimEvidenceCore,
  getWarrantyClaimForActorCore,
  listWarrantyClaimsForActorCore,
  stageServiceStorageCleanupCore,
} = warranty;

if (
  typeof createTechnicianWarrantyClaimCore !== "function"
  || typeof finalizeTechnicianWarrantyClaimEvidenceCore !== "function"
  || typeof getWarrantyClaimForActorCore !== "function"
  || typeof listWarrantyClaimsForActorCore !== "function"
  || typeof stageServiceStorageCleanupCore !== "function"
  || !warrantyClaimNotifications
  || !serviceAttachments.claimId
  || !serviceAttachments.assetId
) {
  throw new Error("technician warranty workflow is not implemented");
}

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const technicianId = "11111111-1111-4111-8111-111111111111";
const removedTechnicianId = "22222222-2222-4222-8222-222222222222";
const managerId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";
const inactiveManagerId = "55555555-5555-4555-8555-555555555555";
await db.insert(profiles).values([
  { id: technicianId, fullName: "Assigned technician", role: "technician" },
  { id: removedTechnicianId, fullName: "Removed technician", role: "technician" },
  { id: managerId, fullName: "Manager", role: "manager" },
  { id: ownerId, fullName: "Owner", role: "owner" },
  { id: inactiveManagerId, fullName: "Inactive manager", role: "manager", isActive: false },
]);
const [project, foreignProject] = await db.insert(projects).values([
  { name: "Camera site", serviceType: "camera", serviceStage: "completed" },
  { name: "Foreign site", serviceType: "camera", serviceStage: "completed" },
]).returning();
const [job, foreignJob, cancelledJob, completedJob] = await db.insert(serviceJobs).values([
  {
    projectId: project.id,
    code: "DV-WARRANTY",
    serviceType: "camera",
    title: "Assigned work",
    status: "warranty",
    assignedTo: technicianId,
  },
  {
    projectId: foreignProject.id,
    code: "DV-FOREIGN",
    serviceType: "camera",
    title: "Foreign work",
    status: "warranty",
    assignedTo: technicianId,
  },
  {
    projectId: project.id,
    code: "DV-CANCELLED",
    serviceType: "camera",
    title: "Cancelled work",
    status: "cancelled",
    assignedTo: technicianId,
  },
  {
    projectId: project.id,
    code: "DV-COMPLETED",
    serviceType: "camera",
    title: "Completed work",
    status: "completed",
    assignedTo: technicianId,
  },
]).returning();
await db.insert(serviceJobAssignments).values([
  { jobId: job.id, profileId: technicianId, assignmentRole: "primary" },
  { jobId: job.id, profileId: removedTechnicianId, assignmentRole: "crew", removedAt: new Date() },
  { jobId: foreignJob.id, profileId: technicianId, assignmentRole: "primary" },
  { jobId: cancelledJob.id, profileId: technicianId, assignmentRole: "primary" },
  { jobId: completedJob.id, profileId: technicianId, assignmentRole: "primary" },
]);
const [asset, foreignAsset] = await db.insert(installedAssets).values([
  {
    projectId: project.id,
    jobId: job.id,
    assetKind: "camera",
    name: "Gate camera",
    status: "installed",
  },
  {
    projectId: foreignProject.id,
    jobId: foreignJob.id,
    assetKind: "camera",
    name: "Foreign camera",
    status: "installed",
  },
]).returning();

const created = await db.transaction((tx) => createTechnicianWarrantyClaimCore(tx, {
  actorId: technicianId,
  jobId: job.id,
  assetId: asset.id,
  title: "  Camera mất tín hiệu  ",
  description: "  Không xem được từ xa  ",
  priority: "high",
  scheduledAt: new Date("2026-08-01T02:00:00.000Z"),
  now: new Date("2026-07-29T02:00:00.000Z"),
}));
if (
  created.projectId !== project.id
  || created.jobId !== job.id
  || created.assetId !== asset.id
  || created.title !== "Camera mất tín hiệu"
) throw new Error("claim scope was not derived from the locked job and asset");

const [event, audit, notifications] = await Promise.all([
  db.select().from(serviceJobEvents).where(eq(serviceJobEvents.jobId, job.id)),
  db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id)),
  db.select().from(warrantyClaimNotifications)
    .where(eq(warrantyClaimNotifications.claimId, created.id)),
]);
if (
  !event.some((row) => row.eventType === "job.warranty_claim_created")
  || audit.length !== 1
  || notifications.map((row) => row.recipientId).sort().join(",") !== [managerId, ownerId].sort().join(",")
) throw new Error("claim timeline, audit, or active manager notification targets are incomplete");

for (const [name, input, message] of [
  ["cross-project asset", { actorId: technicianId, jobId: job.id, assetId: foreignAsset.id }, "SERVICE_WARRANTY_ASSET_MISMATCH"],
  ["cross-project job", { actorId: removedTechnicianId, jobId: foreignJob.id, assetId: foreignAsset.id }, "SERVICE_WARRANTY_FORBIDDEN"],
  ["removed technician", { actorId: removedTechnicianId, jobId: job.id, assetId: asset.id }, "SERVICE_WARRANTY_FORBIDDEN"],
  ["cancelled job", { actorId: technicianId, jobId: cancelledJob.id, assetId: asset.id }, "SERVICE_WARRANTY_JOB_CANCELLED"],
]) {
  let rejected = false;
  try {
    await db.transaction((tx) => createTechnicianWarrantyClaimCore(tx, {
      ...input,
      title: name,
      priority: "normal",
    }));
  } catch (error) {
    rejected = error instanceof Error && error.message === message;
  }
  if (!rejected) throw new Error(`${name} was accepted`);
}

const completedClaim = await db.transaction((tx) => createTechnicianWarrantyClaimCore(tx, {
  actorId: technicianId,
  jobId: completedJob.id,
  assetId: asset.id,
  title: "Issue reported after handover",
  priority: "normal",
}));
if (!completedClaim.id) throw new Error("completed assigned job must accept a warranty report");

const technicianRows = await listWarrantyClaimsForActorCore(db, {
  actorId: technicianId,
  role: "technician",
});
if (!technicianRows.some((row) => row.id === created.id)) {
  throw new Error("assigned technician cannot list related warranty claims");
}
await db.update(serviceJobAssignments).set({ removedAt: new Date() }).where(eq(
  serviceJobAssignments.profileId,
  technicianId,
));
if (
  (await listWarrantyClaimsForActorCore(db, {
    actorId: technicianId,
    role: "technician",
  })).length !== 0
  || await getWarrantyClaimForActorCore(db, {
    actorId: technicianId,
    role: "technician",
    claimId: created.id,
  }) !== null
) throw new Error("removed technician retained warranty claim access");
if (!(await getWarrantyClaimForActorCore(db, {
  actorId: managerId,
  role: "manager",
  claimId: created.id,
}))) throw new Error("manager lost warranty claim detail access");

await db.update(serviceJobAssignments).set({ removedAt: null }).where(eq(
  serviceJobAssignments.profileId,
  technicianId,
));
const [attachment] = await db.insert(serviceAttachments).values({
  projectId: project.id,
  jobId: job.id,
  claimId: created.id,
  assetId: asset.id,
  category: "issue",
  bucket: "service-evidence",
  path: `${project.id}/${job.id}/${created.id}/issue.jpg`,
  fileName: "issue.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 128,
  sha256: "a".repeat(64),
  createdBy: technicianId,
}).returning();
if (!attachment.id) throw new Error("claim evidence could not be tied to claim/job/asset");

let attachmentIdorRejected = false;
try {
  await db.insert(serviceAttachments).values({
    projectId: foreignProject.id,
    jobId: foreignJob.id,
    claimId: created.id,
    assetId: foreignAsset.id,
    category: "issue",
    bucket: "service-evidence",
    path: `${foreignProject.id}/${foreignJob.id}/${created.id}/idor.jpg`,
    fileName: "idor.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 128,
    sha256: "b".repeat(64),
    createdBy: technicianId,
  });
} catch (error) {
  attachmentIdorRejected = error instanceof Error
    && (
      error.message.includes("SERVICE_WARRANTY_ATTACHMENT_SCOPE_MISMATCH")
      || error.cause?.message?.includes("SERVICE_WARRANTY_ATTACHMENT_SCOPE_MISMATCH")
    );
}
if (!attachmentIdorRejected) throw new Error("cross-claim attachment scope was accepted");

const rollbackPath = `${job.id}/${technicianId}/rollback.jpg`;
const [rollbackCleanup] = await db.transaction((tx) =>
  stageServiceStorageCleanupCore(tx, {
    bucket: "service-evidence",
    path: rollbackPath,
    now: new Date("2026-07-29T03:00:00.000Z"),
  }));
let rolledBack = false;
try {
  await db.transaction((tx) => finalizeTechnicianWarrantyClaimEvidenceCore(tx, {
    claim: {
      claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: removedTechnicianId,
      jobId: job.id,
      assetId: asset.id,
      title: "Must roll back",
      priority: "normal",
    },
    cleanupId: rollbackCleanup.id,
    bucket: rollbackCleanup.bucket,
    path: rollbackCleanup.path,
    fileName: "rollback.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 128,
    sha256: "c".repeat(64),
  }));
} catch (error) {
  rolledBack = error instanceof Error && error.message === "SERVICE_WARRANTY_FORBIDDEN";
}
if (!rolledBack) throw new Error("failed claim did not roll back");
if (
  (await db.select().from(serviceCustomerRequestStorageCleanup)
    .where(eq(serviceCustomerRequestStorageCleanup.id, rollbackCleanup.id))).length !== 1
) throw new Error("failed claim lost its durable Storage cleanup row");

const successPath = `${job.id}/${technicianId}/success.jpg`;
const [successCleanup] = await db.transaction((tx) =>
  stageServiceStorageCleanupCore(tx, {
    bucket: "service-evidence",
    path: successPath,
    now: new Date("2026-07-29T03:05:00.000Z"),
  }));
const evidenceClaim = await db.transaction((tx) =>
  finalizeTechnicianWarrantyClaimEvidenceCore(tx, {
    claim: {
      claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      actorId: technicianId,
      jobId: job.id,
      assetId: asset.id,
      title: "Claim with evidence",
      priority: "urgent",
    },
    cleanupId: successCleanup.id,
    bucket: successCleanup.bucket,
    path: successCleanup.path,
    fileName: "success.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 128,
    sha256: "d".repeat(64),
  }));
if (
  !evidenceClaim.id
  || (await db.select().from(serviceCustomerRequestStorageCleanup)
    .where(eq(serviceCustomerRequestStorageCleanup.id, successCleanup.id))).length !== 0
) throw new Error("successful evidence claim did not acknowledge durable cleanup");

console.log("technician warranty: assignment, IDOR, evidence, timeline, audit, and notifications verified");

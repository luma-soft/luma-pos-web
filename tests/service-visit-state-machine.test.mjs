import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, isNull } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  installedAssets,
  products,
  profiles,
  projects,
  serviceAttachments,
  serviceFieldMutations,
  serviceJobMaterials,
  serviceJobs,
  serviceTimeEntries,
  serviceVisits,
} = schema;
const {
  checkInServiceVisitCore,
  checkOutServiceVisitCore,
  completeFieldServiceJobCore,
  createFieldInstalledAssetCore,
  updateFieldChecklistCore,
  updateFieldMaterialUsageCore,
} = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
const { createDefaultChecklist } = await import(`${projectRoot}/src/lib/services/domain.ts`);

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const technicianId = "31111111-1111-4111-8111-111111111111";
await db.insert(profiles).values({
  id: technicianId,
  fullName: "Kỹ thuật viên state machine",
  role: "technician",
});
const [project] = await db.insert(projects).values({
  name: "State machine project",
  serviceType: "camera",
  serviceStage: "active",
}).returning();
const actor = { userId: technicianId, role: "technician" };
let sequence = 0;

async function createJob(status = "scheduled") {
  sequence += 1;
  const [job] = await db.insert(serviceJobs).values({
    projectId: project.id,
    code: `DV-STATE-${sequence}`,
    serviceType: "camera",
    title: `State machine ${sequence}`,
    status,
    assignedTo: technicianId,
    checklist: createDefaultChecklist("camera"),
  }).returning();
  return job;
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => {
    let current = error;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      if (
        current instanceof Error
        && (
          current.message.includes(code)
          || ("constraint" in current && current.constraint === code)
        )
      ) return true;
      current = typeof current === "object" && "cause" in current
        ? current.cause
        : null;
    }
    return false;
  }, `expected ${code}`);
}

const checkInStatusCases = [
  ["new", true],
  ["scheduled", true],
  ["in_progress", true],
  ["warranty", true],
  ["waiting_materials", false],
  ["waiting_customer", false],
  ["completed", false],
  ["cancelled", false],
];
for (const [status, permitted] of checkInStatusCases) {
  const job = await createJob(status);
  const input = {
    jobId: job.id,
    clientMutationId: `status-${status}-checkin`,
  };
  if (permitted) {
    const visit = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, input));
    assert.ok(visit.visitId, `${status} must permit check-in`);
    await db.transaction((tx) => checkOutServiceVisitCore(tx, actor, {
      jobId: job.id,
      clientMutationId: `status-${status}-checkout`,
    }));
  } else {
    await expectCode(
      () => db.transaction((tx) => checkInServiceVisitCore(tx, actor, input)),
      "SERVICE_VISIT_STATUS_INVALID",
    );
    assert.equal(
      (await db.select().from(serviceVisits).where(eq(serviceVisits.jobId, job.id))).length,
      0,
      `${status} rejection must not create a visit`,
    );
    assert.equal(
      (await db.select().from(serviceTimeEntries).where(eq(serviceTimeEntries.jobId, job.id))).length,
      0,
      `${status} rejection must not create a time entry`,
    );
  }
}

const visitJob = await createJob();
const firstVisit = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: visitJob.id,
  clientMutationId: "state-first-checkin",
}, new Date("2026-07-29T01:00:00.000Z")));
const replayedVisit = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: visitJob.id,
  clientMutationId: "state-first-checkin",
}, new Date("2026-07-29T01:05:00.000Z")));
assert.equal(replayedVisit.visitId, firstVisit.visitId, "check-in replay must return its original visit");
await expectCode(
  () => db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
    jobId: visitJob.id,
    clientMutationId: "state-first-checkin",
    latitude: 11.111111,
  })),
  "SERVICE_MUTATION_PAYLOAD_CONFLICT",
);
await expectCode(
  () => db.transaction((tx) => checkOutServiceVisitCore(tx, actor, {
    jobId: visitJob.id,
    clientMutationId: "state-first-checkin",
  })),
  "SERVICE_MUTATION_ID_CONFLICT",
);

await expectCode(
  () => db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
    jobId: visitJob.id,
    clientMutationId: "state-overlapping-checkin",
  })),
  "SERVICE_ACTIVE_VISIT_EXISTS",
);

const [unrelatedTime] = await db.insert(serviceTimeEntries).values({
  jobId: visitJob.id,
  visitId: null,
  profileId: technicianId,
  entryType: "travel",
  startedAt: new Date("2026-07-29T00:30:00.000Z"),
}).returning();
const checkout = await db.transaction((tx) => checkOutServiceVisitCore(tx, actor, {
  jobId: visitJob.id,
  clientMutationId: "state-first-checkout",
}, new Date("2026-07-29T02:00:00.000Z")));
assert.equal(checkout.visitId, firstVisit.visitId);
const [closedWork] = await db.select().from(serviceTimeEntries)
  .where(eq(serviceTimeEntries.visitId, firstVisit.visitId));
const [stillOpenTravel] = await db.select().from(serviceTimeEntries)
  .where(eq(serviceTimeEntries.id, unrelatedTime.id));
assert.ok(closedWork.endedAt, "checkout must close the visit's work entry");
assert.equal(stillOpenTravel.endedAt, null, "checkout must not close another time entry");

const secondVisit = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: visitJob.id,
  clientMutationId: "state-second-checkin",
}, new Date("2026-07-29T03:00:00.000Z")));
assert.notEqual(secondVisit.visitId, firstVisit.visitId, "an in-progress job must allow a later visit");

await expectCode(
  () => db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
    jobId: visitJob.id,
    clientMutationId: "state-open-completion",
    completionNote: "Must not complete",
  })),
  "SERVICE_COMPLETION_OPEN_WORK",
);

const otherJob = await createJob("in_progress");
await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: otherJob.id,
  clientMutationId: "state-other-job-checkin",
}));
const activeAcrossJobs = await db.select().from(serviceVisits).where(and(
  eq(serviceVisits.profileId, technicianId),
  eq(serviceVisits.status, "active"),
));
assert.equal(activeAcrossJobs.length, 2, "active visits are scoped by job and technician");

await expectCode(
  () => db.insert(serviceVisits).values({
    jobId: visitJob.id,
    profileId: technicianId,
    status: "active",
  }),
  "service_visits_job_profile_active_idx",
);

const mutationRows = await db.select().from(serviceFieldMutations).where(and(
  eq(serviceFieldMutations.actorId, technicianId),
  eq(serviceFieldMutations.clientMutationId, "state-first-checkin"),
));
assert.equal(mutationRows.length, 1, "replay must retain one mutation receipt");
assert.match(mutationRows[0].inputHash, /^[0-9a-f]{64}$/, "mutation receipt must hash its input");

const cancelledJob = await createJob("cancelled");
const cancelledChecklist = createDefaultChecklist("camera").map((item) => ({
  code: item.code,
  completed: true,
}));
await expectCode(
  () => db.transaction((tx) => updateFieldChecklistCore(tx, actor, {
    jobId: cancelledJob.id,
    clientMutationId: "terminal-checklist-update",
    expectedVersion: 1,
    checklist: cancelledChecklist,
  })),
  "SERVICE_FIELD_JOB_TERMINAL",
);

const completedJob = await createJob("completed");
await expectCode(
  () => db.transaction((tx) => updateFieldChecklistCore(tx, actor, {
    jobId: completedJob.id,
    clientMutationId: "completed-checklist-update",
    expectedVersion: 1,
    checklist: cancelledChecklist,
  })),
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
);
await expectCode(
  () => db.transaction((tx) => createFieldInstalledAssetCore(tx, actor, {
    jobId: completedJob.id,
    clientMutationId: "completed-asset-create",
    expectedVersion: 1,
    assetKind: "camera",
    name: "Must not exist after completion",
  })),
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
);

const transitionCancelledJob = await createJob("in_progress");
await expectCode(
  () => db.update(serviceJobs).set({
    status: "cancelled",
    checklist: cancelledChecklist,
  }).where(eq(serviceJobs.id, transitionCancelledJob.id)),
  "SERVICE_FIELD_JOB_TERMINAL",
);
const transitionCompletedJob = await createJob("in_progress");
await expectCode(
  () => db.update(serviceJobs).set({
    status: "completed",
    checklist: cancelledChecklist,
  }).where(eq(serviceJobs.id, transitionCompletedJob.id)),
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
);

const directWaitingJob = await createJob("waiting_materials");
await expectCode(
  () => db.insert(serviceVisits).values({
    jobId: directWaitingJob.id,
    profileId: technicianId,
    status: "active",
  }),
  "SERVICE_VISIT_STATUS_INVALID",
);

const terminalCloseJob = await createJob("in_progress");
const terminalCloseVisit = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: terminalCloseJob.id,
  clientMutationId: "terminal-close-checkin",
}));
await db.update(serviceJobs).set({ status: "cancelled" })
  .where(eq(serviceJobs.id, terminalCloseJob.id));
await db.transaction((tx) => checkOutServiceVisitCore(tx, actor, {
  jobId: terminalCloseJob.id,
  clientMutationId: "terminal-close-checkout",
}));
const [closedAfterTerminal] = await db.select().from(serviceVisits)
  .where(eq(serviceVisits.id, terminalCloseVisit.visitId));
assert.equal(closedAfterTerminal.status, "completed", "closing terminal work must remain permitted");
await expectCode(
  () => db.transaction((tx) => createFieldInstalledAssetCore(tx, actor, {
    jobId: cancelledJob.id,
    clientMutationId: "terminal-asset-create",
    expectedVersion: 1,
    assetKind: "camera",
    name: "Must not exist",
  })),
  "SERVICE_FIELD_JOB_TERMINAL",
);

const [product] = await db.insert(products).values({
  name: "State machine cable",
  sku: `STATE-CABLE-${Date.now()}`,
  retailPrice: "1000",
}).returning();
const completedMaterialJob = await createJob("in_progress");
const [completedMaterial] = await db.insert(serviceJobMaterials).values({
  jobId: completedMaterialJob.id,
  productId: product.id,
  unitName: "m",
  plannedQuantity: "10",
}).returning();
await db.update(serviceJobs).set({ status: "completed" })
  .where(eq(serviceJobs.id, completedMaterialJob.id));
await expectCode(
  () => db.transaction((tx) => updateFieldMaterialUsageCore(tx, actor, {
    jobId: completedMaterialJob.id,
    materialId: completedMaterial.id,
    clientMutationId: "completed-material-update",
    expectedVersion: 1,
    usedQuantity: 1,
  })),
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
);

const materialJob = await createJob("in_progress");
const [material] = await db.insert(serviceJobMaterials).values({
  jobId: materialJob.id,
  productId: product.id,
  unitName: "m",
  plannedQuantity: "10",
}).returning();
await db.update(serviceJobs).set({ status: "cancelled" })
  .where(eq(serviceJobs.id, materialJob.id));
await expectCode(
  () => db.transaction((tx) => updateFieldMaterialUsageCore(tx, actor, {
    jobId: materialJob.id,
    materialId: material.id,
    clientMutationId: "terminal-material-update",
    expectedVersion: 1,
    usedQuantity: 1,
  })),
  "SERVICE_FIELD_JOB_TERMINAL",
);
await expectCode(
  () => db.insert(serviceAttachments).values({
    projectId: project.id,
    jobId: completedJob.id,
    category: "before",
    bucket: "service-evidence",
    path: `${completedJob.id}/must-not-exist.jpg`,
    fileName: "must-not-exist.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    createdBy: technicianId,
  }),
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
);

const createdByJob = await createJob("in_progress");
const [createdByAsset] = await db.insert(installedAssets).values({
  projectId: project.id,
  jobId: createdByJob.id,
  assetKind: "camera",
  name: "Created-by guard",
  createdBy: technicianId,
}).returning();
await db.update(serviceJobs).set({ status: "completed" })
  .where(eq(serviceJobs.id, createdByJob.id));
await expectCode(
  () => db.update(installedAssets).set({ createdBy: null })
    .where(eq(installedAssets.id, createdByAsset.id)),
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
);
await db.update(serviceJobs).set({ status: "cancelled" })
  .where(eq(serviceJobs.id, createdByJob.id));
await expectCode(
  () => db.update(installedAssets).set({ createdBy: null })
    .where(eq(installedAssets.id, createdByAsset.id)),
  "SERVICE_FIELD_JOB_TERMINAL",
);

const directTimeJob = await createJob("in_progress");
const [directTimeVisit] = await db.insert(serviceVisits).values({
  jobId: directTimeJob.id,
  profileId: technicianId,
  status: "completed",
  checkedInAt: new Date("2026-07-29T05:00:00.000Z"),
  checkedOutAt: new Date("2026-07-29T06:00:00.000Z"),
}).returning();
await db.update(serviceJobs).set({ status: "cancelled" })
  .where(eq(serviceJobs.id, directTimeJob.id));
await expectCode(
  () => db.insert(serviceTimeEntries).values({
    jobId: directTimeJob.id,
    visitId: directTimeVisit.id,
    profileId: technicianId,
    entryType: "work",
    startedAt: new Date(),
  }),
  "SERVICE_VISIT_STATUS_INVALID",
);

const immutableJob = await createJob("in_progress");
const [immutableVisit, otherImmutableVisit] = await db.insert(serviceVisits).values([
  {
    jobId: immutableJob.id,
    profileId: technicianId,
    status: "completed",
    checkedInAt: new Date("2026-07-29T07:00:00.000Z"),
    checkedOutAt: new Date("2026-07-29T08:00:00.000Z"),
  },
  {
    jobId: immutableJob.id,
    profileId: technicianId,
    status: "completed",
    checkedInAt: new Date("2026-07-29T09:00:00.000Z"),
    checkedOutAt: new Date("2026-07-29T10:00:00.000Z"),
  },
]).returning();
await expectCode(
  () => db.update(serviceVisits).set({ jobId: visitJob.id })
    .where(eq(serviceVisits.id, immutableVisit.id)),
  "SERVICE_VISIT_IDENTITY_IMMUTABLE",
);
await expectCode(
  () => db.update(serviceVisits).set({ status: "active", checkedOutAt: null })
    .where(eq(serviceVisits.id, immutableVisit.id)),
  "SERVICE_VISIT_REOPEN_FORBIDDEN",
);
const [closedImmutableTime] = await db.insert(serviceTimeEntries).values({
  jobId: immutableJob.id,
  visitId: immutableVisit.id,
  profileId: technicianId,
  entryType: "work",
  startedAt: new Date("2026-07-29T07:00:00.000Z"),
  endedAt: new Date("2026-07-29T08:00:00.000Z"),
}).returning();
await expectCode(
  () => db.update(serviceTimeEntries).set({ endedAt: null })
    .where(eq(serviceTimeEntries.id, closedImmutableTime.id)),
  "SERVICE_TIME_ENTRY_REOPEN_FORBIDDEN",
);
await expectCode(
  () => db.update(serviceTimeEntries).set({ visitId: otherImmutableVisit.id })
    .where(eq(serviceTimeEntries.id, closedImmutableTime.id)),
  "SERVICE_TIME_ENTRY_IDENTITY_IMMUTABLE",
);
await expectCode(
  () => db.insert(serviceAttachments).values({
    projectId: project.id,
    jobId: cancelledJob.id,
    category: "before",
    bucket: "service-evidence",
    path: `${cancelledJob.id}/must-not-exist.jpg`,
    fileName: "must-not-exist.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    createdBy: technicianId,
  }),
  "SERVICE_FIELD_JOB_TERMINAL",
);

const cleanupJob = await createJob("in_progress");
const [cleanupAttachment] = await db.insert(serviceAttachments).values({
  projectId: project.id,
  jobId: cleanupJob.id,
  category: "before",
  bucket: "service-evidence",
  path: `${cleanupJob.id}/cleanup.jpg`,
  fileName: "cleanup.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 100,
  createdBy: technicianId,
}).returning();
await db.update(serviceJobs).set({ status: "completed" })
  .where(eq(serviceJobs.id, cleanupJob.id));
await db.update(serviceAttachments).set({
  storageDeleteAttempts: 1,
  storageDeleteLastError: "retryable",
}).where(eq(serviceAttachments.id, cleanupAttachment.id));
const [cleanupBookkeeping] = await db.select().from(serviceAttachments)
  .where(eq(serviceAttachments.id, cleanupAttachment.id));
assert.equal(cleanupBookkeeping.storageDeleteAttempts, 1);
assert.equal(cleanupBookkeeping.storageDeleteLastError, "retryable");

assert.equal(
  (await db.select().from(installedAssets).where(eq(installedAssets.jobId, cancelledJob.id))).length,
  0,
);
assert.equal(
  (await db.select().from(serviceAttachments).where(eq(serviceAttachments.jobId, cancelledJob.id))).length,
  0,
);
assert.equal(
  (await db.select().from(serviceTimeEntries).where(and(
    eq(serviceTimeEntries.visitId, secondVisit.visitId),
    isNull(serviceTimeEntries.endedAt),
  ))).length,
  1,
);

console.log("service visit state machine: terminal guards, replay, visits, checkout, and open-work completion verified");

await client.close();

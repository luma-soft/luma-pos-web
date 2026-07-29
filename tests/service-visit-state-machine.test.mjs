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

for (const status of ["completed", "cancelled"]) {
  const job = await createJob(status);
  await expectCode(
    () => db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
      jobId: job.id,
      clientMutationId: `terminal-${status}-checkin`,
    })),
    "SERVICE_VISIT_STATUS_INVALID",
  );
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

const cancelledJob = await createJob("cancelled");
const cancelledChecklist = createDefaultChecklist("camera").map((item) => ({
  code: item.code,
  completed: true,
}));
await expectCode(
  () => db.transaction((tx) => updateFieldChecklistCore(tx, actor, {
    jobId: cancelledJob.id,
    clientMutationId: "terminal-checklist-update",
    checklist: cancelledChecklist,
  })),
  "SERVICE_FIELD_JOB_TERMINAL",
);
await expectCode(
  () => db.transaction((tx) => createFieldInstalledAssetCore(tx, actor, {
    jobId: cancelledJob.id,
    clientMutationId: "terminal-asset-create",
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
    usedQuantity: 1,
  })),
  "SERVICE_FIELD_JOB_TERMINAL",
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

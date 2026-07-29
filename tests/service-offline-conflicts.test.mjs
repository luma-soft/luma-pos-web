import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  installedAssets,
  products,
  profiles,
  projects,
  serviceFieldMutations,
  serviceJobAssignments,
  serviceJobMaterials,
  serviceJobs,
} = schema;
const {
  createFieldInstalledAssetCore,
  updateFieldChecklistCore,
  updateFieldMaterialUsageCore,
} = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
const { mobileFieldOperation } = await import(
  `${projectRoot}/src/lib/services/field-api.ts`
);
const { createDefaultChecklist } = await import(
  `${projectRoot}/src/lib/services/domain.ts`
);

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) =>
  name.endsWith(".sql")
).sort()) {
  for (const statement of readFileSync(
    `${projectRoot}/drizzle/${file}`,
    "utf8",
  ).split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const technicianId = "81111111-1111-4111-8111-111111111111";
const otherTechnicianId = "82222222-2222-4222-8222-222222222222";
await db.insert(profiles).values([
  {
    id: technicianId,
    fullName: "Offline technician",
    role: "technician",
  },
  {
    id: otherTechnicianId,
    fullName: "Removed technician",
    role: "technician",
  },
]);
const [project] = await db.insert(projects).values({
  name: "Offline conflict project",
  serviceType: "camera",
  serviceStage: "active",
}).returning();
const checklist = createDefaultChecklist("camera");
const [job] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-CONFLICT-1",
  serviceType: "camera",
  title: "Offline conflict",
  status: "in_progress",
  assignedTo: technicianId,
  checklist,
}).returning();
const [product] = await db.insert(products).values({
  name: "Conflict cable",
  sku: "CONFLICT-CABLE",
  unit: "m",
}).returning();
const [material] = await db.insert(serviceJobMaterials).values({
  jobId: job.id,
  productId: product.id,
  unitName: "m",
  plannedQuantity: "10",
}).returning();
const actor = { userId: technicianId, role: "technician" };

assert.equal(job.version, 1);
assert.equal(job.checklistVersion, 1);
assert.equal(job.assetsVersion, 1);
assert.equal(material.version, 1);

const checklistResult = await db.transaction((tx) =>
  updateFieldChecklistCore(tx, actor, {
    jobId: job.id,
    clientMutationId: "offline-checklist-0001",
    expectedVersion: 1,
    checklist: checklist.map((item, index) => ({
      ...item,
      completed: index === 0,
    })),
  }, new Date("2026-07-29T03:00:00.000Z"))
);
assert.equal(checklistResult.version, 2);
assert.equal(checklistResult.checklist[0].completed, true);

const replayedChecklist = await db.transaction((tx) =>
  updateFieldChecklistCore(tx, actor, {
    jobId: job.id,
    clientMutationId: "offline-checklist-0001",
    expectedVersion: 1,
    checklist: checklist.map((item, index) => ({
      ...item,
      completed: index === 0,
    })),
  }, new Date("2026-07-29T03:05:00.000Z"))
);
assert.deepEqual(
  replayedChecklist,
  checklistResult,
  "an exact replay returns the original result after the version advances",
);

await assert.rejects(
  () => db.transaction((tx) =>
    updateFieldChecklistCore(tx, actor, {
      jobId: job.id,
      clientMutationId: "offline-checklist-stale",
      expectedVersion: 1,
      checklist: checklist.map((item) => ({ ...item, completed: true })),
    })
  ),
  (error) => {
    assert.equal(error.code, "SERVICE_VERSION_CONFLICT");
    assert.deepEqual(Object.keys(error.conflict).sort(), [
      "currentVersion",
      "refresh",
      "resourceId",
      "resourceType",
      "updatedAt",
    ]);
    assert.equal(error.conflict.resourceType, "checklist");
    assert.equal(error.conflict.resourceId, job.id);
    assert.equal(error.conflict.currentVersion, 2);
    assert.equal(error.conflict.refresh.checklist[0].completed, true);
    assert.equal("projectId" in error.conflict.refresh, false);
    assert.equal("customerName" in error.conflict.refresh, false);
    return true;
  },
);

const conflictResponse = await mobileFieldOperation(() =>
  db.transaction((tx) =>
    updateFieldChecklistCore(tx, actor, {
      jobId: job.id,
      clientMutationId: "offline-checklist-http",
      expectedVersion: 1,
      checklist: checklist.map((item) => ({ ...item, completed: true })),
    })
  )
);
assert.equal(conflictResponse.status, 409);
const conflictBody = await conflictResponse.json();
assert.equal(conflictBody.error, "services.errors.versionConflict");
assert.equal(conflictBody.conflict.resourceType, "checklist");
assert.equal(conflictBody.conflict.currentVersion, 2);

await assert.rejects(
  () => db.transaction((tx) =>
    updateFieldChecklistCore(tx, actor, {
      jobId: job.id,
      clientMutationId: "offline-checklist-0001",
      expectedVersion: 2,
      checklist: checklist.map((item) => ({ ...item, completed: true })),
    })
  ),
  /SERVICE_MUTATION_PAYLOAD_CONFLICT/,
);

const materialResult = await db.transaction((tx) =>
  updateFieldMaterialUsageCore(tx, actor, {
    jobId: job.id,
    materialId: material.id,
    clientMutationId: "offline-material-0001",
    expectedVersion: 1,
    usedQuantity: 3,
    note: "first",
  }, new Date("2026-07-29T03:10:00.000Z"))
);
assert.equal(materialResult.version, 2);
await assert.rejects(
  () => db.transaction((tx) =>
    updateFieldMaterialUsageCore(tx, actor, {
      jobId: job.id,
      materialId: material.id,
      clientMutationId: "offline-material-stale",
      expectedVersion: 1,
      usedQuantity: 4,
    })
  ),
  (error) => {
    assert.equal(error.code, "SERVICE_VERSION_CONFLICT");
    assert.equal(error.conflict.resourceType, "material");
    assert.equal(error.conflict.resourceId, material.id);
    assert.deepEqual(Object.keys(error.conflict.refresh).sort(), [
      "note",
      "usedQuantity",
    ]);
    return true;
  },
);

const assetResult = await db.transaction((tx) =>
  createFieldInstalledAssetCore(tx, actor, {
    jobId: job.id,
    clientMutationId: "offline-asset-0001",
    expectedVersion: 1,
    assetKind: "camera",
    name: "Camera A",
    serialNumber: "CONFLICT-SN-1",
  }, new Date("2026-07-29T03:15:00.000Z"))
);
assert.equal(assetResult.assetsVersion, 2);
assert.equal(assetResult.version, 1);

const [versionsBeforeHousekeeping] = await db.select({
  version: serviceJobs.version,
  checklistVersion: serviceJobs.checklistVersion,
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
await db.update(serviceJobs).set({
  updatedAt: new Date("2026-07-29T03:16:00.000Z"),
}).where(eq(serviceJobs.id, job.id));
const [versionsAfterHousekeeping] = await db.select({
  version: serviceJobs.version,
  checklistVersion: serviceJobs.checklistVersion,
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
assert.deepEqual(
  versionsAfterHousekeeping,
  versionsBeforeHousekeeping,
  "housekeeping-only job updates must not advance any client version",
);

await db.update(serviceJobs).set({ title: "Canonical title update" })
  .where(eq(serviceJobs.id, job.id));
const [versionsAfterJobUpdate] = await db.select({
  version: serviceJobs.version,
  checklistVersion: serviceJobs.checklistVersion,
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
assert.equal(versionsAfterJobUpdate.version, versionsBeforeHousekeeping.version + 1);
assert.equal(
  versionsAfterJobUpdate.checklistVersion,
  versionsBeforeHousekeeping.checklistVersion,
);
assert.equal(versionsAfterJobUpdate.assetsVersion, versionsBeforeHousekeeping.assetsVersion);

await db.update(serviceJobMaterials).set({
  plannedQuantity: material.plannedQuantity,
  usedQuantity: "3",
  note: "first",
  updatedAt: new Date("2026-07-29T03:17:00.000Z"),
}).where(eq(serviceJobMaterials.id, material.id));
const [materialAfterNoop] = await db.select().from(serviceJobMaterials)
  .where(eq(serviceJobMaterials.id, material.id));
assert.equal(materialAfterNoop.version, materialResult.version);
await db.update(serviceJobMaterials).set({ note: "canonical material update" })
  .where(eq(serviceJobMaterials.id, material.id));
const [materialAfterChange] = await db.select().from(serviceJobMaterials)
  .where(eq(serviceJobMaterials.id, material.id));
assert.equal(materialAfterChange.version, materialResult.version + 1);

await db.update(installedAssets).set({
  updatedAt: new Date("2026-07-29T03:18:00.000Z"),
}).where(eq(installedAssets.id, assetResult.id));
const [assetAfterNoop] = await db.select().from(installedAssets)
  .where(eq(installedAssets.id, assetResult.id));
const [jobAfterAssetNoop] = await db.select({
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
assert.equal(assetAfterNoop.version, assetResult.version);
assert.equal(jobAfterAssetNoop.assetsVersion, assetResult.assetsVersion);

await db.update(installedAssets).set({ ipAddress: "192.0.2.10" })
  .where(eq(installedAssets.id, assetResult.id));
const [assetAfterChange] = await db.select().from(installedAssets)
  .where(eq(installedAssets.id, assetResult.id));
const [jobAfterAssetChange] = await db.select({
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
assert.equal(assetAfterChange.version, assetResult.version + 1);
assert.equal(jobAfterAssetChange.assetsVersion, assetResult.assetsVersion + 1);

const [secondAsset] = await db.insert(installedAssets).values({
  projectId: project.id,
  jobId: job.id,
  assetKind: "camera",
  name: "Temporary camera",
}).returning();
const [jobAfterAssetInsert] = await db.select({
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
assert.equal(jobAfterAssetInsert.assetsVersion, jobAfterAssetChange.assetsVersion + 1);
await db.delete(installedAssets).where(eq(installedAssets.id, secondAsset.id));
const [jobAfterAssetDelete] = await db.select({
  assetsVersion: serviceJobs.assetsVersion,
}).from(serviceJobs).where(eq(serviceJobs.id, job.id));
assert.equal(jobAfterAssetDelete.assetsVersion, jobAfterAssetInsert.assetsVersion + 1);

await assert.rejects(
  () => db.transaction((tx) =>
    createFieldInstalledAssetCore(tx, actor, {
      jobId: job.id,
      clientMutationId: "offline-asset-stale",
      expectedVersion: 1,
      assetKind: "camera",
      name: "Camera B",
      serialNumber: "CONFLICT-SN-2",
    })
  ),
  (error) => {
    assert.equal(error.code, "SERVICE_VERSION_CONFLICT");
    assert.equal(error.conflict.resourceType, "asset");
    assert.equal(error.conflict.resourceId, job.id);
    assert.deepEqual(Object.keys(error.conflict.refresh), ["assets"]);
    assert.equal(error.conflict.refresh.assets.length, 1);
    assert.deepEqual(Object.keys(error.conflict.refresh.assets[0]).sort(), [
      "id",
      "name",
      "version",
    ]);
    return true;
  },
);

const [removedJob] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-CONFLICT-2",
  serviceType: "camera",
  title: "Removed assignment",
  status: "in_progress",
  checklist,
}).returning();
await db.insert(serviceJobAssignments).values({
  jobId: removedJob.id,
  profileId: otherTechnicianId,
  assignmentRole: "crew",
});
const removedActor = {
  userId: otherTechnicianId,
  role: "technician",
};
await db.transaction((tx) =>
  updateFieldChecklistCore(tx, removedActor, {
    jobId: removedJob.id,
    clientMutationId: "offline-removed-replay",
    expectedVersion: 1,
    checklist: checklist.map((item, index) => ({
      ...item,
      completed: index === 0,
    })),
  })
);
await db.update(serviceJobAssignments).set({
  removedAt: new Date("2026-07-29T03:20:00.000Z"),
}).where(and(
  eq(serviceJobAssignments.jobId, removedJob.id),
  eq(serviceJobAssignments.profileId, otherTechnicianId),
));
await assert.rejects(
  () => db.transaction((tx) =>
    updateFieldChecklistCore(tx, removedActor, {
      jobId: removedJob.id,
      clientMutationId: "offline-removed-replay",
      expectedVersion: 1,
      checklist: checklist.map((item, index) => ({
        ...item,
        completed: index === 0,
      })),
    })
  ),
  /SERVICE_JOB_FORBIDDEN/,
  "assignment removal must block even an otherwise exact replay",
);

const receipts = await db.select().from(serviceFieldMutations).where(
  eq(serviceFieldMutations.jobId, job.id),
);
assert.equal(
  receipts.some((receipt) =>
    receipt.clientMutationId === "offline-checklist-stale"
  ),
  false,
  "a stale rejected mutation must not retain an incomplete receipt",
);

const [persistedAsset] = await db.select().from(installedAssets).where(
  eq(installedAssets.id, assetResult.id),
);
assert.equal(persistedAsset.version, assetAfterChange.version);

console.log(
  "offline field conflicts: versions, replay, safe payload, and isolation verified",
);

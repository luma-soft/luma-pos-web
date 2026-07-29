import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("maintenance manager actions: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const common = await import(`${projectRoot}/src/lib/actions/common.ts`);
  const managerId = randomUUID();
  mock.module("@/lib/actions/common", () => ({
    ...common,
    requireManager: async () => ({
      ok: true,
      userId: managerId,
      role: "manager",
    }),
  }));
  mock.module("next/cache", () => ({
    revalidatePath: () => undefined,
    unstable_cache: (callback) => callback,
  }));

  const { db } = await import(`${projectRoot}/src/db/index.ts`);
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    installedAssets,
    products,
    profiles,
    projects,
    serviceJobMaterials,
    serviceJobAssignments,
    serviceJobs,
    serviceMaintenanceOccurrences,
    serviceMaintenancePlans,
  } = schema;
  const {
    deleteServiceMaintenancePlan,
    createInstalledAsset,
    saveServiceMaintenancePlan,
    saveServiceJobMaterial,
    transitionServiceJob,
    updateInstalledAsset,
    updateServiceJob,
  } = await import(`${projectRoot}/src/lib/actions/services.ts`);
  const technicianId = randomUUID();
  const replacementId = randomUUID();
  let projectId;
  let productId;
  try {
    await db.insert(profiles).values([
      { id: managerId, fullName: "Manager action fixture", role: "manager" },
      { id: technicianId, fullName: "Technician action fixture", role: "technician" },
      { id: replacementId, fullName: "Replacement fixture", role: "technician" },
    ]);
    const [project] = await db.insert(projects).values({
      name: `manager-maintenance-${randomUUID()}`,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;
    const [product] = await db.insert(products).values({
      name: `Manager version fixture ${randomUUID()}`,
      sku: `MGR-VERSION-${randomUUID()}`,
      unit: "pcs",
    }).returning();
    productId = product.id;
    assert.deepEqual(await saveServiceMaintenancePlan({
      projectId,
      serviceType: "camera",
      title: "Invalid manager assignment",
      intervalDays: 30,
      nextDueOn: "2026-08-01",
      assignedTo: managerId,
      isActive: true,
      note: "",
    }), {
      ok: false,
      error: "services.errors.invalidAssignee",
    });
    const [plan] = await db.insert(serviceMaintenancePlans).values({
      projectId,
      serviceType: "camera",
      title: "Manager completion lifecycle",
      intervalDays: 30,
      nextDueOn: "2026-08-01",
      assignedTo: technicianId,
    }).returning();
    const [job] = await db.insert(serviceJobs).values({
      projectId,
      code: `MGR-${randomUUID().slice(0, 12)}`,
      serviceType: "camera",
      title: "Generated maintenance manager completion",
      status: "in_progress",
      priority: "normal",
      assignedTo: technicianId,
    }).returning();
    await db.insert(serviceJobAssignments).values({
      jobId: job.id,
      profileId: technicianId,
      assignmentRole: "primary",
      assignedBy: managerId,
    });
    await db.insert(serviceMaintenanceOccurrences).values({
      planId: plan.id,
      projectId,
      jobId: job.id,
      dueOn: "2026-08-01",
      status: "scheduled",
    });

    assert.deepEqual(
      await transitionServiceJob({ jobId: job.id, status: "completed" }),
      { ok: true, data: undefined },
    );
    assert.deepEqual(
      await transitionServiceJob({ jobId: job.id, status: "completed" }),
      { ok: true, data: undefined },
    );
    const [completedPlan] = await db.select().from(serviceMaintenancePlans)
      .where(eq(serviceMaintenancePlans.id, plan.id));
    const [completedOccurrence] = await db.select().from(serviceMaintenanceOccurrences)
      .where(eq(serviceMaintenanceOccurrences.jobId, job.id));
    assert.equal(completedOccurrence.status, "completed");
    assert.equal(completedPlan.nextDueOn, "2026-08-31");

    const [managerUpdateJob] = await db.insert(serviceJobs).values({
      projectId,
      code: `MGR-UPDATE-${randomUUID().slice(0, 8)}`,
      serviceType: "camera",
      title: "Manager combined update",
      status: "in_progress",
      priority: "normal",
      assignedTo: technicianId,
    }).returning();
    await db.insert(serviceJobAssignments).values({
      jobId: managerUpdateJob.id,
      profileId: technicianId,
      assignmentRole: "primary",
      assignedBy: managerId,
    });
    const invalidUpdate = await updateServiceJob({
      jobId: managerUpdateJob.id,
      serviceType: "camera",
      title: managerUpdateJob.title,
      priority: "normal",
      assignedTo: managerId,
      scheduledAt: null,
      description: "",
      quoteOrderId: null,
      materialOrderId: null,
    });
    assert.deepEqual(invalidUpdate, {
      ok: false,
      error: "services.errors.invalidAssignee",
    });
    const updateResult = await updateServiceJob({
      jobId: managerUpdateJob.id,
      serviceType: "camera",
      title: `${managerUpdateJob.title} reassigned`,
      priority: "normal",
      assignedTo: replacementId,
      scheduledAt: null,
      description: "",
      quoteOrderId: null,
      materialOrderId: null,
    });
    assert.deepEqual(updateResult, { ok: true, data: undefined });
    const [reassignedJob] = await db.select().from(serviceJobs)
      .where(eq(serviceJobs.id, managerUpdateJob.id));
    const primaries = await db.select().from(serviceJobAssignments).where(and(
      eq(serviceJobAssignments.jobId, managerUpdateJob.id),
      eq(serviceJobAssignments.assignmentRole, "primary"),
      isNull(serviceJobAssignments.removedAt),
    ));
    assert.equal(reassignedJob.assignedTo, replacementId);
    assert.equal(
      reassignedJob.version,
      managerUpdateJob.version + 1,
      "combined manager reassignment/content save must bump exactly once",
    );
    assert.deepEqual(primaries.map((row) => row.profileId), [replacementId]);

    assert.deepEqual(await updateServiceJob({
      jobId: managerUpdateJob.id,
      serviceType: "camera",
      title: `${managerUpdateJob.title} reassigned`,
      priority: "normal",
      assignedTo: replacementId,
      scheduledAt: null,
      description: "",
      quoteOrderId: null,
      materialOrderId: null,
    }), { ok: true, data: undefined });
    const [jobAfterIdenticalSave] = await db.select().from(serviceJobs)
      .where(eq(serviceJobs.id, managerUpdateJob.id));
    assert.equal(
      jobAfterIdenticalSave.version,
      reassignedJob.version,
      "an identical manager save must not advance the job version",
    );

    const materialInput = {
      jobId: managerUpdateJob.id,
      productId,
      unitName: "pcs",
      plannedQuantity: 2,
      usedQuantity: 1,
      note: "same values",
    };
    assert.deepEqual(await saveServiceJobMaterial(materialInput), {
      ok: true,
      data: undefined,
    });
    const [savedMaterial] = await db.select().from(serviceJobMaterials)
      .where(eq(serviceJobMaterials.jobId, managerUpdateJob.id));
    assert.deepEqual(await saveServiceJobMaterial(materialInput), {
      ok: true,
      data: undefined,
    });
    const [identicalMaterial] = await db.select().from(serviceJobMaterials)
      .where(eq(serviceJobMaterials.id, savedMaterial.id));
    assert.equal(identicalMaterial.version, savedMaterial.version);

    const createdAsset = await createInstalledAsset({
      projectId,
      jobId: managerUpdateJob.id,
      productId,
      assetKind: "camera",
      name: "Manager camera",
      ipAddress: "192.0.2.20",
    });
    assert.equal(createdAsset.ok, true);
    const [savedAsset] = await db.select().from(installedAssets)
      .where(eq(installedAssets.id, createdAsset.data.id));
    const [jobBeforeIdenticalAssetSave] = await db.select().from(serviceJobs)
      .where(eq(serviceJobs.id, managerUpdateJob.id));
    assert.deepEqual(await updateInstalledAsset({
      assetId: savedAsset.id,
      jobId: managerUpdateJob.id,
      productId,
      assetKind: "camera",
      name: "Manager camera",
      brand: "",
      model: "",
      serialNumber: "",
      macAddress: "",
      ipAddress: "192.0.2.20",
      locationLabel: "",
      installedAt: null,
      customerWarrantyEndsOn: null,
      supplierWarrantyEndsOn: null,
      status: "installed",
      note: "",
    }), { ok: true, data: undefined });
    const [identicalAsset] = await db.select().from(installedAssets)
      .where(eq(installedAssets.id, savedAsset.id));
    const [jobAfterIdenticalAssetSave] = await db.select().from(serviceJobs)
      .where(eq(serviceJobs.id, managerUpdateJob.id));
    assert.equal(identicalAsset.version, savedAsset.version);
    assert.equal(
      jobAfterIdenticalAssetSave.assetsVersion,
      jobBeforeIdenticalAssetSave.assetsVersion,
    );

    assert.deepEqual(
      await deleteServiceMaintenancePlan(plan.id),
      { ok: false, error: "services.errors.maintenanceHistoryExists" },
    );
    const [unusedPlan] = await db.insert(serviceMaintenancePlans).values({
      projectId,
      serviceType: "camera",
      title: "Unused deletable plan",
      intervalDays: 30,
      nextDueOn: "2027-01-01",
    }).returning();
    assert.deepEqual(
      await deleteServiceMaintenancePlan(unusedPlan.id),
      { ok: true, data: undefined },
    );
    console.log("maintenance manager actions: completion, replay, reassignment, and delete policy verified");
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (productId) await db.delete(products).where(eq(products.id, productId));
    await db.delete(profiles).where(eq(profiles.id, managerId));
    await db.delete(profiles).where(eq(profiles.id, technicianId));
    await db.delete(profiles).where(eq(profiles.id, replacementId));
  }
}

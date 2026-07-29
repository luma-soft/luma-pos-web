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
  mock.module("next/cache", () => ({ revalidatePath: () => undefined }));

  const { db } = await import(`${projectRoot}/src/db/index.ts`);
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    profiles,
    projects,
    serviceJobAssignments,
    serviceJobs,
    serviceMaintenanceOccurrences,
    serviceMaintenancePlans,
  } = schema;
  const {
    deleteServiceMaintenancePlan,
    saveServiceMaintenancePlan,
    transitionServiceJob,
    updateServiceJob,
  } = await import(`${projectRoot}/src/lib/actions/services.ts`);
  const technicianId = randomUUID();
  const replacementId = randomUUID();
  let projectId;
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

    const invalidUpdate = await updateServiceJob({
      jobId: job.id,
      serviceType: "camera",
      title: job.title,
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
      jobId: job.id,
      serviceType: "camera",
      title: job.title,
      priority: "normal",
      assignedTo: replacementId,
      scheduledAt: null,
      description: "",
      quoteOrderId: null,
      materialOrderId: null,
    });
    assert.deepEqual(updateResult, { ok: true, data: undefined });
    const [reassignedJob] = await db.select().from(serviceJobs)
      .where(eq(serviceJobs.id, job.id));
    const primaries = await db.select().from(serviceJobAssignments).where(and(
      eq(serviceJobAssignments.jobId, job.id),
      eq(serviceJobAssignments.assignmentRole, "primary"),
      isNull(serviceJobAssignments.removedAt),
    ));
    assert.equal(reassignedJob.assignedTo, replacementId);
    assert.deepEqual(primaries.map((row) => row.profileId), [replacementId]);

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
    await db.delete(profiles).where(eq(profiles.id, managerId));
    await db.delete(profiles).where(eq(profiles.id, technicianId));
    await db.delete(profiles).where(eq(profiles.id, replacementId));
  }
}

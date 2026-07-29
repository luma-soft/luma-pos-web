import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("service dispatch/reporting PostgreSQL: skipped because DATABASE_URL is unset");
} else {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const { db } = await import(`${root}/src/db/index.ts`);
  const schema = await import(`${root}/src/db/schema.ts`);
  const {
    auditLogs,
    profiles,
    projects,
    serviceCustomerRequests,
    serviceJobAssignments,
    serviceJobEvents,
    serviceJobs,
    serviceMaintenanceOccurrences,
    serviceMaintenancePlans,
    serviceTimeEntries,
    serviceVisits,
  } = schema;
  const {
    getServiceDispatchPage,
    getServiceManagerReport,
    parseServiceDispatchQuery,
    parseServiceReportQuery,
  } = await import(`${root}/src/lib/services/dispatch-reporting.ts`);
  const {
    assignServiceJobCore,
    unassignServiceJobCore,
  } = await import(`${root}/src/lib/services/job-assignment.ts`);

  const managerId = randomUUID();
  const technicianId = randomUUID();
  const projectName = `dispatch-report-${randomUUID()}`;
  let projectId;
  try {
    await db.insert(profiles).values([
      { id: managerId, fullName: "Dispatch Manager", role: "manager" },
      { id: technicianId, fullName: "Dispatch Technician", role: "technician" },
    ]);
    const [project] = await db.insert(projects).values({
      name: projectName,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;
    const [first, second] = await db.insert(serviceJobs).values([
      {
        projectId,
        code: `DSP-${randomUUID().slice(0, 12)}`,
        serviceType: "camera",
        title: "Overdue one visit",
        status: "in_progress",
        priority: "urgent",
        scheduledAt: new Date("2026-07-29T02:00:00.000Z"),
        completedAt: new Date("2026-07-29T04:00:00.000Z"),
      },
      {
        projectId,
        code: `DSP-${randomUUID().slice(0, 12)}`,
        serviceType: "camera",
        title: "Two visits",
        status: "in_progress",
        priority: "normal",
        scheduledAt: new Date("2026-07-30T02:00:00.000Z"),
        completedAt: new Date("2026-07-30T05:00:00.000Z"),
      },
    ]).returning();
    await db.transaction((tx) => assignServiceJobCore(tx, {
      jobId: first.id,
      profileId: technicianId,
      assignmentRole: "primary",
      actorId: managerId,
      now: new Date("2026-07-28T00:00:00.000Z"),
    }));
    await db.transaction((tx) => assignServiceJobCore(tx, {
      jobId: second.id,
      profileId: technicianId,
      assignmentRole: "primary",
      actorId: managerId,
      now: new Date("2026-07-28T00:00:00.000Z"),
    }));
    await db.insert(serviceCustomerRequests).values({
      code: `REQ-${randomUUID().slice(0, 12)}`,
      projectId,
      title: "SLA fixture",
      contactName: "Customer",
      tokenHash: `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
      tokenExpiresAt: new Date("2026-08-31T00:00:00.000Z"),
      linkedJobId: first.id,
      responseDueAt: new Date("2026-07-28T00:00:00.000Z"),
      resolutionDueAt: new Date("2026-07-31T00:00:00.000Z"),
    });
    const [plan] = await db.insert(serviceMaintenancePlans).values({
      projectId,
      serviceType: "camera",
      title: "Dispatch overdue fixture",
      intervalDays: 30,
      nextDueOn: "2026-07-28",
    }).returning();
    await db.insert(serviceMaintenanceOccurrences).values({
      planId: plan.id,
      projectId,
      jobId: first.id,
      dueOn: "2026-07-28",
      status: "overdue",
    });
    for (const [job, count] of [[first, 1], [second, 2]]) {
      for (let index = 0; index < count; index += 1) {
        const start = new Date(job.scheduledAt.getTime() + index * 3_600_000);
        const end = new Date(start.getTime() + 1_800_000);
        const [visit] = await db.insert(serviceVisits).values({
          jobId: job.id,
          profileId: technicianId,
          status: "completed",
          checkedInAt: start,
          checkedOutAt: end,
        }).returning();
        await db.insert(serviceTimeEntries).values({
          jobId: job.id,
          visitId: visit.id,
          profileId: technicianId,
          startedAt: start,
          endedAt: end,
        });
      }
    }
    await db.update(serviceJobs).set({ status: "completed" })
      .where(inArray(serviceJobs.id, [first.id, second.id]));
    await db.update(serviceMaintenanceOccurrences).set({
      status: "overdue",
      completedAt: null,
    }).where(eq(serviceMaintenanceOccurrences.jobId, first.id));

    const dispatch = await getServiceDispatchPage(parseServiceDispatchQuery(
      new URLSearchParams({
        from: "2026-07-28T17:00:00.000Z",
        to: "2026-07-31T17:00:00.000Z",
        technicianId,
        priority: "urgent",
        slaOverdue: "true",
        maintenanceOverdue: "true",
      }),
      new Date("2026-07-30T00:00:00.000Z"),
    ), new Date("2026-07-30T00:00:00.000Z"));
    assert.equal(dispatch.total, 1);
    assert.equal(dispatch.rows[0].id, first.id);
    assert.equal(dispatch.rows[0].slaOverdue, true);
    assert.equal(dispatch.rows[0].maintenanceOverdue, true);
    assert.deepEqual(Object.keys(dispatch.rows[0]).sort(), [
      "address", "assignedTo", "assignedToName", "code", "customerName", "id",
      "maintenanceOverdue", "priority", "projectId", "projectName", "scheduledAt",
      "serviceType", "slaOverdue", "status", "title", "updatedAt",
    ]);

    const report = await getServiceManagerReport(parseServiceReportQuery(
      new URLSearchParams({
        from: "2026-07-28T17:00:00.000Z",
        to: "2026-07-31T17:00:00.000Z",
      }),
    ), new Date("2026-07-30T00:00:00.000Z"));
    assert.equal(report.metrics.total, 2);
    assert.equal(report.metrics.completed, 2);
    assert.equal(report.metrics.visits, 3);
    assert.equal(report.metrics.workMinutes, 90);
    assert.equal(report.metrics.firstTimeCompletion.numerator, 1);
    assert.equal(report.metrics.firstTimeCompletion.denominator, 2);

    await db.transaction((tx) => unassignServiceJobCore(tx, {
      jobId: first.id,
      profileId: technicianId,
      actorId: managerId,
    }));
    const [unassigned] = await db.select({ assignedTo: serviceJobs.assignedTo })
      .from(serviceJobs).where(eq(serviceJobs.id, first.id));
    assert.equal(unassigned.assignedTo, null);
    const [activeAssignment, unassignedEvent, unassignedAudit] = await Promise.all([
      db.select().from(serviceJobAssignments).where(and(
        eq(serviceJobAssignments.jobId, first.id),
        eq(serviceJobAssignments.profileId, technicianId),
        isNull(serviceJobAssignments.removedAt),
      )),
      db.select().from(serviceJobEvents).where(and(
        eq(serviceJobEvents.jobId, first.id),
        eq(serviceJobEvents.eventType, "job.unassigned"),
      )),
      db.select().from(auditLogs).where(and(
        eq(auditLogs.entityId, first.id),
        eq(auditLogs.action, "service_job.assignment.remove"),
      )),
    ]);
    assert.equal(activeAssignment.length, 0);
    assert.equal(unassignedEvent.length, 1);
    assert.equal(unassignedAudit.length, 1);
    console.log("service dispatch/reporting PostgreSQL: filters, metrics, safe shape, and unassignment verified");
  } finally {
    if (projectId) {
      const jobIds = await db.select({ id: serviceJobs.id })
        .from(serviceJobs).where(eq(serviceJobs.projectId, projectId));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, jobIds.map((row) => row.id)));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
    await db.delete(profiles).where(inArray(profiles.id, [managerId, technicianId]));
  }
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("service visit PostgreSQL concurrency: skipped because DATABASE_URL is unset");
} else {
  let assignmentManagerId;
  mock.module("@/lib/mobile/auth", () => ({
    requireMobileManager: async () => ({
      ok: true,
      userId: assignmentManagerId,
      role: "manager",
    }),
  }));

  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    profiles,
    projects,
    serviceAttachments,
    serviceJobAssignments,
    serviceJobs,
    serviceTimeEntries,
    serviceVisits,
  } = schema;
  const {
    checkInServiceVisitCore,
    completeFieldServiceJobCore,
    createServiceSignatureCore,
  } = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
  const { POST: assignServiceJob } = await import(
    `${projectRoot}/src/app/api/mobile/services/jobs/[id]/assignments/route.ts`
  );
  const { createDefaultChecklist } = await import(`${projectRoot}/src/lib/services/domain.ts`);

  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const db = drizzle(pool, { schema });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const technicianId = randomUUID();
  const otherTechnicianId = randomUUID();
  const thirdTechnicianId = randomUUID();
  assignmentManagerId = technicianId;
  const namespace = `visit-race-${randomUUID()}`;
  let projectId;

  function hasCode(error, code) {
    let current = error;
    for (let depth = 0; depth < 6 && current; depth += 1) {
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
  }

  async function transactionOn(client, operation) {
    await client.query("BEGIN");
    try {
      const result = await operation(drizzle(client, { schema }));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  let jobSequence = 0;
  async function createJob({ readyToComplete = false } = {}) {
    jobSequence += 1;
    const checklist = createDefaultChecklist("camera").map((item) => ({
      ...item,
      completed: readyToComplete,
    }));
    const [job] = await db.insert(serviceJobs).values({
      projectId,
      code: `RACE-${namespace.slice(-8)}-${jobSequence}`,
      serviceType: "camera",
      title: `Concurrency fixture ${jobSequence}`,
      status: "in_progress",
      assignedTo: technicianId,
      checklist,
    }).returning();

    if (readyToComplete) {
      for (const category of ["before", "after", "signature"]) {
        const [attachment] = await db.insert(serviceAttachments).values({
          projectId,
          jobId: job.id,
          category,
          bucket: "service-evidence",
          path: `${namespace}/${job.id}/${category}.png`,
          fileName: `${category}.png`,
          mimeType: "image/png",
          sizeBytes: 100,
          createdBy: technicianId,
        }).returning();
        if (category === "signature") {
          await db.transaction((tx) => createServiceSignatureCore(tx, {
            userId: technicianId,
            role: "technician",
          }, {
            jobId: job.id,
            attachmentId: attachment.id,
            signerName: "Concurrency customer",
            clientMutationId: `sign-${randomUUID()}`,
          }));
        }
      }
    }
    return job;
  }

  try {
    await db.insert(profiles).values({
      id: technicianId,
      fullName: namespace,
      role: "technician",
    });
    await db.insert(profiles).values({
      id: otherTechnicianId,
      fullName: `${namespace}-other`,
      role: "technician",
    });
    await db.insert(profiles).values({
      id: thirdTechnicianId,
      fullName: `${namespace}-third`,
      role: "technician",
    });
    const [project] = await db.insert(projects).values({
      name: namespace,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;
    const actor = { userId: technicianId, role: "technician" };

    const concurrentAssignmentJob = await createJob();
    await clientA.query("BEGIN");
    await clientA.query("SELECT id FROM service_jobs WHERE id = $1 FOR UPDATE", [
      concurrentAssignmentJob.id,
    ]);
    const assignPrimary = (profileId) => assignServiceJob(
      new Request(
        `http://localhost/api/mobile/services/jobs/${concurrentAssignmentJob.id}/assignments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profileId, assignmentRole: "primary" }),
        },
      ),
      { params: Promise.resolve({ id: concurrentAssignmentJob.id }) },
    );
    let concurrentAssignmentsSettled = false;
    const concurrentAssignments = Promise.all([
      assignPrimary(otherTechnicianId),
      assignPrimary(thirdTechnicianId),
    ]).finally(() => {
      concurrentAssignmentsSettled = true;
    });
    await delay(1000);
    assert.equal(
      concurrentAssignmentsSettled,
      false,
      "both primary assignments must wait behind the existing job lock",
    );
    await clientA.query("COMMIT");
    const assignmentResponses = await concurrentAssignments;
    assert.deepEqual(
      assignmentResponses.map((response) => response.status),
      [200, 200],
    );
    const [assignedJob] = await db.select({ assignedTo: serviceJobs.assignedTo })
      .from(serviceJobs)
      .where(eq(serviceJobs.id, concurrentAssignmentJob.id));
    const activePrimaryAssignments = await db.select({
      profileId: serviceJobAssignments.profileId,
    }).from(serviceJobAssignments).where(and(
      eq(serviceJobAssignments.jobId, concurrentAssignmentJob.id),
      eq(serviceJobAssignments.assignmentRole, "primary"),
      isNull(serviceJobAssignments.removedAt),
    ));
    assert.deepEqual(
      activePrimaryAssignments.map((assignment) => assignment.profileId),
      [assignedJob.assignedTo],
      "concurrent primary assignment must leave one active row matching assigned_to",
    );
    const staleAssigneeId = assignedJob.assignedTo === otherTechnicianId
      ? thirdTechnicianId
      : otherTechnicianId;
    await assert.rejects(
      db.transaction((tx) => checkInServiceVisitCore(tx, {
        userId: staleAssigneeId,
        role: "technician",
      }, {
        jobId: concurrentAssignmentJob.id,
        clientMutationId: `stale-concurrent-primary-${randomUUID()}`,
      })),
      (error) => hasCode(error, "SERVICE_JOB_FORBIDDEN"),
    );

    const primaryRemovalJob = await createJob();
    await clientA.query("BEGIN");
    await drizzle(clientA, { schema }).update(serviceJobs).set({
      assignedTo: otherTechnicianId,
    }).where(eq(serviceJobs.id, primaryRemovalJob.id));
    let stalePrimarySettled = false;
    const stalePrimaryMutation = transactionOn(clientB, (tx) => checkInServiceVisitCore(
      tx,
      actor,
      {
        jobId: primaryRemovalJob.id,
        clientMutationId: `stale-primary-${randomUUID()}`,
      },
    )).finally(() => {
      stalePrimarySettled = true;
    });
    await delay(75);
    assert.equal(stalePrimarySettled, false, "primary reassignment must hold the job lock");
    await clientA.query("COMMIT");
    await assert.rejects(
      stalePrimaryMutation,
      (error) => hasCode(error, "SERVICE_JOB_FORBIDDEN"),
    );
    assert.equal(
      (await db.select().from(serviceVisits)
        .where(eq(serviceVisits.jobId, primaryRemovalJob.id))).length,
      0,
    );

    const crewRemovalJob = await createJob();
    await db.update(serviceJobs).set({ assignedTo: otherTechnicianId })
      .where(eq(serviceJobs.id, crewRemovalJob.id));
    const [crewAssignment] = await db.insert(serviceJobAssignments).values({
      jobId: crewRemovalJob.id,
      profileId: technicianId,
      assignmentRole: "crew",
      assignedBy: otherTechnicianId,
    }).returning();
    await clientA.query("BEGIN");
    await drizzle(clientA, { schema }).update(serviceJobAssignments).set({
      removedAt: new Date(),
    }).where(eq(serviceJobAssignments.id, crewAssignment.id));
    let staleCrewSettled = false;
    const staleCrewMutation = transactionOn(clientB, (tx) => checkInServiceVisitCore(
      tx,
      actor,
      {
        jobId: crewRemovalJob.id,
        clientMutationId: `stale-crew-${randomUUID()}`,
      },
    )).finally(() => {
      staleCrewSettled = true;
    });
    await delay(75);
    const crewRemovalHeldJobLock = !staleCrewSettled;
    await clientA.query("COMMIT");
    let crewRemovalRejected = false;
    try {
      await staleCrewMutation;
    } catch (error) {
      crewRemovalRejected = hasCode(error, "SERVICE_JOB_FORBIDDEN");
    }
    assert.equal(crewRemovalHeldJobLock, true, "crew removal must hold the job lock");
    assert.equal(crewRemovalRejected, true, "removed crew must fail locked reauthorization");

    const sameJob = await createJob();
    const sameJobResults = await Promise.allSettled([
      transactionOn(clientA, (tx) => checkInServiceVisitCore(tx, actor, {
        jobId: sameJob.id,
        clientMutationId: `checkin-a-${randomUUID()}`,
      })),
      transactionOn(clientB, (tx) => checkInServiceVisitCore(tx, actor, {
        jobId: sameJob.id,
        clientMutationId: `checkin-b-${randomUUID()}`,
      })),
    ]);
    assert.equal(sameJobResults.filter((item) => item.status === "fulfilled").length, 1);
    const rejectedCheckIn = sameJobResults.find((item) => item.status === "rejected");
    assert.ok(
      rejectedCheckIn && hasCode(rejectedCheckIn.reason, "SERVICE_ACTIVE_VISIT_EXISTS"),
      "one concurrent check-in must lose to the active-visit constraint",
    );
    assert.equal(
      (await db.select().from(serviceVisits).where(eq(serviceVisits.jobId, sameJob.id))).length,
      1,
    );
    assert.equal(
      (await db.select().from(serviceTimeEntries).where(eq(serviceTimeEntries.jobId, sameJob.id))).length,
      1,
    );

    const checkInWinsJob = await createJob({ readyToComplete: true });
    await clientA.query("BEGIN");
    await checkInServiceVisitCore(drizzle(clientA, { schema }), actor, {
      jobId: checkInWinsJob.id,
      clientMutationId: `checkin-wins-${randomUUID()}`,
    });
    let completionSettled = false;
    const blockedCompletion = transactionOn(clientB, (tx) => completeFieldServiceJobCore(
      tx,
      actor,
      {
        jobId: checkInWinsJob.id,
        clientMutationId: `completion-loses-${randomUUID()}`,
        completionNote: "Must wait for check-in",
      },
    )).finally(() => {
      completionSettled = true;
    });
    await delay(75);
    assert.equal(completionSettled, false, "completion must wait on the check-in job lock");
    await clientA.query("COMMIT");
    await assert.rejects(
      blockedCompletion,
      (error) => hasCode(error, "SERVICE_COMPLETION_OPEN_WORK"),
    );

    const completionWinsJob = await createJob({ readyToComplete: true });
    await clientA.query("BEGIN");
    await completeFieldServiceJobCore(drizzle(clientA, { schema }), actor, {
      jobId: completionWinsJob.id,
      clientMutationId: `completion-wins-${randomUUID()}`,
      completionNote: "Completion owns the lock",
    });
    let checkInSettled = false;
    const blockedCheckIn = transactionOn(clientB, (tx) => checkInServiceVisitCore(
      tx,
      actor,
      {
        jobId: completionWinsJob.id,
        clientMutationId: `checkin-loses-${randomUUID()}`,
      },
    )).finally(() => {
      checkInSettled = true;
    });
    await delay(75);
    assert.equal(checkInSettled, false, "check-in must wait on the completion job lock");
    await clientA.query("COMMIT");
    await assert.rejects(
      blockedCheckIn,
      (error) => hasCode(error, "SERVICE_VISIT_STATUS_INVALID"),
    );
    const [completedWithoutVisit] = await db.select().from(serviceJobs)
      .where(eq(serviceJobs.id, completionWinsJob.id));
    assert.equal(completedWithoutVisit.status, "completed");
    assert.equal(
      (await db.select().from(serviceVisits)
        .where(eq(serviceVisits.jobId, completionWinsJob.id))).length,
      0,
    );

    const duplicateTimeJob = await createJob();
    const [duplicateTimeVisit] = await db.insert(serviceVisits).values({
      jobId: duplicateTimeJob.id,
      profileId: technicianId,
      status: "active",
    }).returning();
    const timeEntryResults = await Promise.allSettled([
      transactionOn(clientA, (tx) => tx.insert(serviceTimeEntries).values({
        jobId: duplicateTimeJob.id,
        visitId: duplicateTimeVisit.id,
        profileId: technicianId,
        entryType: "work",
        startedAt: new Date(),
      })),
      transactionOn(clientB, (tx) => tx.insert(serviceTimeEntries).values({
        jobId: duplicateTimeJob.id,
        visitId: duplicateTimeVisit.id,
        profileId: technicianId,
        entryType: "work",
        startedAt: new Date(),
      })),
    ]);
    assert.equal(timeEntryResults.filter((item) => item.status === "fulfilled").length, 1);
    const rejectedTime = timeEntryResults.find((item) => item.status === "rejected");
    assert.ok(
      rejectedTime && hasCode(rejectedTime.reason, "service_time_entries_visit_open_idx"),
      "one concurrent open time entry must lose to the partial unique index",
    );

    const closureRaceJob = await createJob({ readyToComplete: true });
    const closureRaceCheckIn = await db.transaction((tx) => checkInServiceVisitCore(
      tx,
      actor,
      {
        jobId: closureRaceJob.id,
        clientMutationId: `closure-race-checkin-${randomUUID()}`,
      },
    ));
    const [closureTimeEntry] = await db.select().from(serviceTimeEntries)
      .where(eq(serviceTimeEntries.visitId, closureRaceCheckIn.visitId));
    await clientA.query("BEGIN");
    await clientA.query("SELECT id FROM service_jobs WHERE id = $1 FOR UPDATE", [
      closureRaceJob.id,
    ]);
    let closureSettled = false;
    const childClosure = transactionOn(clientB, async (tx) => {
      await tx.update(serviceVisits).set({
        status: "completed",
        checkedOutAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(serviceVisits.id, closureRaceCheckIn.visitId));
      await tx.update(serviceTimeEntries).set({
        endedAt: new Date(),
      }).where(eq(serviceTimeEntries.id, closureTimeEntry.id));
    }).finally(() => {
      closureSettled = true;
    });
    await delay(3000);
    const childClosureAvoidedJobLock = closureSettled;
    if (!childClosureAvoidedJobLock) {
      await clientA.query("ROLLBACK");
      await childClosure;
    } else {
      await childClosure;
      await completeFieldServiceJobCore(drizzle(clientA, { schema }), actor, {
        jobId: closureRaceJob.id,
        clientMutationId: `closure-race-complete-${randomUUID()}`,
        completionNote: "Children closed without inverse job lock",
      });
      await clientA.query("COMMIT");
    }
    assert.equal(
      childClosureAvoidedJobLock,
      true,
      "visit/time closure must not wait on a job lock held by completion",
    );

    console.log("service visit PostgreSQL concurrency: independent-session races verified");
  } finally {
    for (const client of [clientA, clientB]) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The client may already be outside a transaction.
      }
    }
    if (projectId) {
      await db.update(serviceJobs).set({ status: "in_progress" })
        .where(eq(serviceJobs.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
    await db.delete(profiles).where(eq(profiles.id, technicianId));
    await db.delete(profiles).where(eq(profiles.id, otherTechnicianId));
    await db.delete(profiles).where(eq(profiles.id, thirdTechnicianId));
    clientA.release();
    clientB.release();
    await pool.end();
  }
}

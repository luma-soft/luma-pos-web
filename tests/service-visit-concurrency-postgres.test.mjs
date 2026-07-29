import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("service visit PostgreSQL concurrency: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    profiles,
    projects,
    serviceAttachments,
    serviceJobs,
    serviceTimeEntries,
    serviceVisits,
  } = schema;
  const {
    checkInServiceVisitCore,
    completeFieldServiceJobCore,
    createServiceSignatureCore,
  } = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
  const { createDefaultChecklist } = await import(`${projectRoot}/src/lib/services/domain.ts`);

  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const db = drizzle(pool, { schema });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const technicianId = randomUUID();
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
    const [project] = await db.insert(projects).values({
      name: namespace,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;
    const actor = { userId: technicianId, role: "technician" };

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
    clientA.release();
    clientB.release();
    await pool.end();
  }
}

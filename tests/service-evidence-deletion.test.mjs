import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  profiles,
  projects,
  serviceAttachments,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
  serviceSignatures,
} = schema;
const {
  deleteServiceEvidenceCore,
  completeServiceEvidenceStorageRemoval,
} = await import(
  `${projectRoot}/src/lib/services/evidence-deletion.ts`
);

const creatorId = "11111111-1111-4111-8111-111111111111";
const foreignId = "22222222-2222-4222-8222-222222222222";
const managerId = "33333333-3333-4333-8333-333333333333";

async function createFixture(status = "scheduled") {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (sql && !/create extension/i.test(sql)) await client.exec(sql);
    }
  }
  await db.insert(profiles).values([
    { id: creatorId, fullName: "Creator", role: "technician" },
    { id: foreignId, fullName: "Foreign", role: "technician" },
    { id: managerId, fullName: "Manager", role: "manager" },
  ]);
  const [project] = await db.insert(projects).values({
    name: "Evidence deletion project",
    serviceType: "camera",
    serviceStage: "active",
  }).returning();
  const [job] = await db.insert(serviceJobs).values({
    projectId: project.id,
    code: "EVIDENCE-DELETE-1",
    serviceType: "camera",
    title: "Evidence deletion",
    status: status === "completed" || status === "cancelled" ? "in_progress" : status,
    assignedTo: creatorId,
    checklist: [],
  }).returning();
  const [attachment] = await db.insert(serviceAttachments).values({
    projectId: project.id,
    jobId: job.id,
    category: "after",
    bucket: "service-evidence",
    path: `${project.id}/${job.id}/after.jpg`,
    fileName: "after.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    createdBy: creatorId,
  }).returning();
  if (status === "completed" || status === "cancelled") {
    await db.update(serviceJobs).set({ status })
      .where(eq(serviceJobs.id, job.id));
  }
  return { client, db, project, job, attachment };
}

function storageThatRemoves() {
  const removed = [];
  return {
    removed,
    storage: {
      async remove(bucket, path) {
        removed.push({ bucket, path });
      },
    },
  };
}

describe("service evidence deletion", () => {
  test("tombstones unsigned creator evidence before Storage cleanup and records a job event", async () => {
    const { db, job, attachment } = await createFixture();
    const { storage, removed } = storageThatRemoves();

    await db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: creatorId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }));

    const [tombstone] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(tombstone.deletedAt).toBeInstanceOf(Date);
    expect(tombstone.storageDeletedAt).toBeNull();
    await completeServiceEvidenceStorageRemoval(db, storage, {
      jobId: job.id,
      attachmentId: attachment.id,
    });

    const [cleaned] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(cleaned.deletedAt).toBeInstanceOf(Date);
    expect(cleaned.storageDeletedAt).toBeInstanceOf(Date);
    expect(removed).toEqual([{ bucket: "service-evidence", path: attachment.path }]);
    expect(await db.select({ eventType: serviceJobEvents.eventType, payload: serviceJobEvents.payload })
      .from(serviceJobEvents)
      .where(eq(serviceJobEvents.jobId, job.id)))
      .toEqual([{ eventType: "job.attachment_deleted", payload: { attachmentId: attachment.id } }]);
  });

  test("rejects signed evidence before deleting its Storage object", async () => {
    const { db, project, job, attachment } = await createFixture();
    await db.insert(serviceSignatures).values({
      projectId: project.id,
      jobId: job.id,
      attachmentId: attachment.id,
      signerName: "Customer",
      documentHash: "a".repeat(64),
    });

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: creatorId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_SIGNED");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
  });

  test("rejects a foreign technician from deleting unsigned evidence", async () => {
    const { db, job, attachment } = await createFixture();
    await db.insert(serviceJobAssignments).values({
      jobId: job.id,
      profileId: foreignId,
      assignmentRole: "crew",
    });

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: foreignId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_FORBIDDEN");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
  });

  test("allows a manager to tombstone unsigned evidence created by another technician", async () => {
    const { db, job, attachment } = await createFixture();

    await db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: managerId,
      role: "manager",
    }, { jobId: job.id, attachmentId: attachment.id }));

    const [tombstone] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(tombstone.deletedAt).toBeInstanceOf(Date);
  });

  test("keeps an unsigned tombstone when Storage cleanup fails so retry cannot restore signing", async () => {
    const { db, job, attachment } = await createFixture();
    const { storage, removed } = storageThatRemoves();

    await db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: creatorId,
      role: "technician",
    }, {
      jobId: job.id,
      attachmentId: attachment.id,
    }));
    await expect(completeServiceEvidenceStorageRemoval(db, {
      async remove() {
        throw new Error("storage unavailable");
      },
    }, {
      jobId: job.id,
      attachmentId: attachment.id,
    })).rejects.toThrow("storage unavailable");

    const [tombstone] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(tombstone.deletedAt).toBeInstanceOf(Date);
    expect(tombstone.storageDeletedAt).toBeNull();
    expect(tombstone.storageDeleteAttempts).toBe(1);
    expect(await db.select().from(serviceJobEvents).where(eq(serviceJobEvents.jobId, job.id))).toHaveLength(1);

    await completeServiceEvidenceStorageRemoval(db, storage, {
      jobId: job.id,
      attachmentId: attachment.id,
    });
    const [cleaned] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(cleaned.storageDeletedAt).toBeInstanceOf(Date);
    expect(removed).toEqual([{ bucket: "service-evidence", path: attachment.path }]);
  });

  test("allows only one concurrent cleanup claimant to remove the Storage object", async () => {
    const { db, job, attachment } = await createFixture();
    await db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: creatorId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }));

    let removeCalls = 0;
    let startRemoval;
    let releaseRemoval;
    const removalStarted = new Promise((resolve) => { startRemoval = resolve; });
    const removalReleased = new Promise((resolve) => { releaseRemoval = resolve; });
    const storage = {
      async remove() {
        removeCalls++;
        startRemoval();
        await removalReleased;
      },
    };

    const firstCleanup = completeServiceEvidenceStorageRemoval(db, storage, {
      jobId: job.id,
      attachmentId: attachment.id,
    });
    await removalStarted;
    const secondResult = await completeServiceEvidenceStorageRemoval(db, storage, {
      jobId: job.id,
      attachmentId: attachment.id,
    });
    expect(removeCalls).toBe(1);
    expect(secondResult.storagePending).toBe(true);

    releaseRemoval();
    await firstCleanup;
    const [attachmentAfterCleanup] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(attachmentAfterCleanup.storageDeletedAt).toBeInstanceOf(Date);
    expect(attachmentAfterCleanup.cleanupClaimedAt).toBeNull();
  });

  test("database rejects direct signatures for tombstoned evidence", async () => {
    const { db, project, job, attachment } = await createFixture();

    await db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: creatorId,
      role: "technician",
    }, {
      jobId: job.id,
      attachmentId: attachment.id,
    }));

    let failure;
    try {
      await db.insert(serviceSignatures).values({
        projectId: project.id,
        jobId: job.id,
        attachmentId: attachment.id,
        signerName: "Customer",
        documentHash: "a".repeat(64),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
  });

  test("rolls back the tombstone when the deletion event database write fails", async () => {
    const { db, job, attachment } = await createFixture();

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(new Proxy(tx, {
      get(target, property, receiver) {
        if (property === "insert") {
          return (table) => table === serviceJobEvents
            ? { values: async () => { throw new Error("event insert failed"); } }
            : target.insert(table);
        }
        return Reflect.get(target, property, receiver);
      },
    }), { userId: creatorId, role: "technician" }, {
      jobId: job.id,
      attachmentId: attachment.id,
    }))).rejects.toThrow("event insert failed");

    const [attachmentAfterRollback] = await db.select().from(serviceAttachments)
      .where(eq(serviceAttachments.id, attachment.id));
    expect(attachmentAfterRollback.deletedAt).toBeNull();
    expect(await db.select().from(serviceJobEvents).where(eq(serviceJobEvents.jobId, job.id))).toEqual([]);
  });

  test("locks deletion after a job is completed", async () => {
    const { db, job, attachment } = await createFixture("completed");

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: managerId,
      role: "manager",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_JOB_LOCKED");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
  });

  test("locks deletion after a job is cancelled", async () => {
    const { db, job, attachment } = await createFixture("cancelled");

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: managerId,
      role: "manager",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_JOB_LOCKED");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
  });

  test("rejects a creator who was removed from the job assignment", async () => {
    const { db, job, attachment } = await createFixture();
    await db.update(serviceJobs).set({ assignedTo: foreignId })
      .where(eq(serviceJobs.id, job.id));
    await db.insert(serviceJobAssignments).values({
      jobId: job.id,
      profileId: creatorId,
      assignmentRole: "crew",
      removedAt: new Date(),
    });

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: creatorId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_JOB_FORBIDDEN");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
  });
});

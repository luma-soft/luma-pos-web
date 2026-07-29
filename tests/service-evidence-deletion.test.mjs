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
  serviceJobEvents,
  serviceJobs,
  serviceSignatures,
} = schema;
const { deleteServiceEvidenceCore } = await import(
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
    status,
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
  test("deletes unsigned creator evidence and records a job event", async () => {
    const { db, job, attachment } = await createFixture();
    const { storage, removed } = storageThatRemoves();

    await db.transaction((tx) => deleteServiceEvidenceCore(tx, storage, {
      userId: creatorId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }));

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toEqual([]);
    expect(removed).toEqual([{ bucket: "service-evidence", path: attachment.path }]);
    expect(await db.select({ eventType: serviceJobEvents.eventType, payload: serviceJobEvents.payload })
      .from(serviceJobEvents)
      .where(eq(serviceJobEvents.jobId, job.id)))
      .toEqual([{ eventType: "job.attachment_deleted", payload: { attachmentId: attachment.id } }]);
  });

  test("rejects signed evidence before deleting its Storage object", async () => {
    const { db, project, job, attachment } = await createFixture();
    const { storage, removed } = storageThatRemoves();
    await db.insert(serviceSignatures).values({
      projectId: project.id,
      jobId: job.id,
      attachmentId: attachment.id,
      signerName: "Customer",
      documentHash: "a".repeat(64),
    });

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, storage, {
      userId: creatorId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_SIGNED");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  test("rejects a foreign technician from deleting unsigned evidence", async () => {
    const { db, job, attachment } = await createFixture();
    const { storage, removed } = storageThatRemoves();

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, storage, {
      userId: foreignId,
      role: "technician",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_FORBIDDEN");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  test("allows a manager to delete unsigned evidence created by another technician", async () => {
    const { db, job, attachment } = await createFixture();
    const { storage } = storageThatRemoves();

    await db.transaction((tx) => deleteServiceEvidenceCore(tx, storage, {
      userId: managerId,
      role: "manager",
    }, { jobId: job.id, attachmentId: attachment.id }));

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toEqual([]);
  });

  test("keeps metadata when Storage deletion fails", async () => {
    const { db, job, attachment } = await createFixture();

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      async remove() {
        throw new Error("storage unavailable");
      },
    }, { userId: creatorId, role: "technician" }, {
      jobId: job.id,
      attachmentId: attachment.id,
    }))).rejects.toThrow("storage unavailable");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
    expect(await db.select().from(serviceJobEvents).where(eq(serviceJobEvents.jobId, job.id))).toEqual([]);
  });

  test("rolls back metadata deletion when the post-Storage database write fails", async () => {
    const { db, job, attachment } = await createFixture();
    const { storage, removed } = storageThatRemoves();

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(new Proxy(tx, {
      get(target, property, receiver) {
        if (property === "insert") {
          return (table) => table === serviceJobEvents
            ? { values: async () => { throw new Error("event insert failed"); } }
            : target.insert(table);
        }
        return Reflect.get(target, property, receiver);
      },
    }), storage, { userId: creatorId, role: "technician" }, {
      jobId: job.id,
      attachmentId: attachment.id,
    }))).rejects.toThrow("event insert failed");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
    expect(await db.select().from(serviceJobEvents).where(eq(serviceJobEvents.jobId, job.id))).toEqual([]);
    expect(removed).toEqual([{ bucket: "service-evidence", path: attachment.path }]);
  });

  test("locks deletion after a job is completed", async () => {
    const { db, job, attachment } = await createFixture("completed");
    const { storage, removed } = storageThatRemoves();

    await expect(db.transaction((tx) => deleteServiceEvidenceCore(tx, storage, {
      userId: managerId,
      role: "manager",
    }, { jobId: job.id, attachmentId: attachment.id }))).rejects.toThrow("SERVICE_ATTACHMENT_JOB_LOCKED");

    expect(await db.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id))).toHaveLength(1);
    expect(removed).toEqual([]);
  });
});

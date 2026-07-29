import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("technician warranty PostgreSQL concurrency: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    auditLogs,
    installedAssets,
    profiles,
    projects,
    serviceAttachments,
    serviceJobAssignments,
    serviceJobs,
    warrantyClaims,
  } = schema;
  const {
    getWarrantyClaimForActorCore,
  } = await import(`${projectRoot}/src/lib/services/technician-warranty.ts`);
  const {
    unassignServiceJobCore,
  } = await import(`${projectRoot}/src/lib/services/job-assignment.ts`);

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool, { schema });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const technicianId = randomUUID();
  const managerId = randomUUID();
  const namespace = `warranty-read-race-${randomUUID()}`;
  let projectId;

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

  async function fixture(sequence) {
    const [job] = await db.insert(serviceJobs).values({
      projectId,
      code: `WR-${namespace.slice(-8)}-${sequence}`,
      serviceType: "camera",
      title: `Warranty read ${sequence}`,
      status: "warranty",
      assignedTo: technicianId,
    }).returning();
    await db.insert(serviceJobAssignments).values({
      jobId: job.id,
      profileId: technicianId,
      assignmentRole: "primary",
      assignedBy: managerId,
    });
    const [asset] = await db.insert(installedAssets).values({
      projectId,
      jobId: job.id,
      assetKind: "camera",
      name: `Camera ${sequence}`,
      status: "installed",
    }).returning();
    const [claim] = await db.insert(warrantyClaims).values({
      projectId,
      jobId: job.id,
      assetId: asset.id,
      code: `BH-${namespace.slice(-8)}-${sequence}`,
      title: `Claim ${sequence}`,
      createdBy: technicianId,
    }).returning();
    await db.insert(serviceAttachments).values({
      projectId,
      jobId: job.id,
      claimId: claim.id,
      assetId: asset.id,
      category: "issue",
      bucket: "service-evidence",
      path: `${namespace}/${claim.id}/issue.png`,
      fileName: "issue.png",
      mimeType: "image/png",
      sizeBytes: 128,
      sha256: "a".repeat(64),
      createdBy: technicianId,
    });
    return { job, claim };
  }

  try {
    await db.insert(profiles).values([
      { id: technicianId, fullName: namespace, role: "technician" },
      { id: managerId, fullName: `${namespace}-manager`, role: "manager" },
    ]);
    const [project] = await db.insert(projects).values({
      name: namespace,
      serviceType: "camera",
      serviceStage: "warranty",
    }).returning();
    projectId = project.id;

    const removalFirst = await fixture(1);
    await clientA.query("BEGIN");
    await clientA.query("SELECT id FROM service_jobs WHERE id = $1 FOR UPDATE", [
      removalFirst.job.id,
    ]);
    await drizzle(clientA, { schema }).update(serviceJobAssignments).set({
      removedAt: new Date(),
    }).where(eq(serviceJobAssignments.jobId, removalFirst.job.id));
    let readSettled = false;
    const staleRead = transactionOn(clientB, (tx) =>
      getWarrantyClaimForActorCore(tx, {
        actorId: technicianId,
        role: "technician",
        claimId: removalFirst.claim.id,
      })).finally(() => {
      readSettled = true;
    });
    await delay(100);
    assert.equal(readSettled, false, "warranty detail read bypassed removal job lock");
    await clientA.query("COMMIT");
    assert.equal(await staleRead, null, "removed technician read claim/attachment metadata");

    const readFirst = await fixture(2);
    await clientA.query("BEGIN");
    const authorizedRead = await getWarrantyClaimForActorCore(
      drizzle(clientA, { schema }),
      {
        actorId: technicianId,
        role: "technician",
        claimId: readFirst.claim.id,
      },
    );
    assert.equal(authorizedRead?.attachments.length, 1);
    let removalSettled = false;
    const removal = transactionOn(clientB, (tx) => unassignServiceJobCore(tx, {
      jobId: readFirst.job.id,
      profileId: technicianId,
      actorId: managerId,
    })).finally(() => {
      removalSettled = true;
    });
    await delay(100);
    assert.equal(removalSettled, false, "assignment removal bypassed warranty read job lock");
    await clientA.query("COMMIT");
    await removal;
    const afterRemoval = await db.transaction((tx) =>
      getWarrantyClaimForActorCore(tx, {
        actorId: technicianId,
        role: "technician",
        claimId: readFirst.claim.id,
      }));
    assert.equal(afterRemoval, null);

    console.log("technician warranty PostgreSQL concurrency: both lock orderings verified");
  } finally {
    try {
      if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
      await db.delete(auditLogs).where(eq(auditLogs.actorId, technicianId));
      await db.delete(auditLogs).where(eq(auditLogs.actorId, managerId));
      await db.delete(profiles).where(eq(profiles.id, technicianId));
      await db.delete(profiles).where(eq(profiles.id, managerId));
    } finally {
      clientA.release();
      clientB.release();
      await pool.end();
    }
  }
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log("offline PostgreSQL concurrency: skipped because TEST_DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    products,
    profiles,
    projects,
    serviceJobMaterials,
    serviceJobs,
  } = schema;
  const {
    createFieldInstalledAssetCore,
    updateFieldChecklistCore,
    updateFieldMaterialUsageCore,
  } = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
  const { createDefaultChecklist } = await import(
    `${projectRoot}/src/lib/services/domain.ts`
  );

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool, { schema });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const technicianId = randomUUID();
  const namespace = `offline-race-${randomUUID()}`;
  let projectId;
  let productId;

  async function transactionOn(client, operation) {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    try {
      const result = await operation(drizzle(client, { schema }));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  function isVersionConflict(error) {
    return error?.code === "SERVICE_VERSION_CONFLICT";
  }

  async function assertSingleWinner(operations, label) {
    const results = await Promise.allSettled(operations);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
      `${label}: exactly one same-version writer must commit`,
    );
    const [rejected] = results.filter((result) => result.status === "rejected");
    assert.ok(
      isVersionConflict(rejected.reason),
      `${label}: the losing writer must receive a version conflict`,
    );
  }

  let sequence = 0;
  async function createJob() {
    sequence += 1;
    const [job] = await db.insert(serviceJobs).values({
      projectId,
      code: `OFF-${namespace.slice(-8)}-${sequence}`,
      serviceType: "camera",
      title: `Offline race ${sequence}`,
      status: "in_progress",
      assignedTo: technicianId,
      checklist: createDefaultChecklist("camera"),
    }).returning();
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
    const [product] = await db.insert(products).values({
      name: namespace,
      sku: `OFF-${randomUUID()}`,
      unit: "m",
    }).returning();
    productId = product.id;
    const actor = { userId: technicianId, role: "technician" };

    const checklistJob = await createJob();
    await assertSingleWinner([
      transactionOn(clientA, (tx) => updateFieldChecklistCore(tx, actor, {
        jobId: checklistJob.id,
        clientMutationId: `check-a-${randomUUID()}`,
        expectedVersion: 1,
        checklist: checklistJob.checklist.map((item, index) => ({
          ...item,
          completed: index === 0,
        })),
      })),
      transactionOn(clientB, (tx) => updateFieldChecklistCore(tx, actor, {
        jobId: checklistJob.id,
        clientMutationId: `check-b-${randomUUID()}`,
        expectedVersion: 1,
        checklist: checklistJob.checklist.map((item, index) => ({
          ...item,
          completed: index === 1,
        })),
      })),
    ], "checklist");

    const materialJob = await createJob();
    const [material] = await db.insert(serviceJobMaterials).values({
      jobId: materialJob.id,
      productId: product.id,
      unitName: "m",
      plannedQuantity: "10",
    }).returning();
    await assertSingleWinner([
      transactionOn(clientA, (tx) => updateFieldMaterialUsageCore(tx, actor, {
        jobId: materialJob.id,
        materialId: material.id,
        clientMutationId: `material-a-${randomUUID()}`,
        expectedVersion: 1,
        usedQuantity: 2,
      })),
      transactionOn(clientB, (tx) => updateFieldMaterialUsageCore(tx, actor, {
        jobId: materialJob.id,
        materialId: material.id,
        clientMutationId: `material-b-${randomUUID()}`,
        expectedVersion: 1,
        usedQuantity: 3,
      })),
    ], "material");

    const assetJob = await createJob();
    await assertSingleWinner([
      transactionOn(clientA, (tx) => createFieldInstalledAssetCore(tx, actor, {
        jobId: assetJob.id,
        clientMutationId: `asset-a-${randomUUID()}`,
        expectedVersion: 1,
        assetKind: "camera",
        name: "Camera A",
        serialNumber: `A-${randomUUID()}`,
      })),
      transactionOn(clientB, (tx) => createFieldInstalledAssetCore(tx, actor, {
        jobId: assetJob.id,
        clientMutationId: `asset-b-${randomUUID()}`,
        expectedVersion: 1,
        assetKind: "camera",
        name: "Camera B",
        serialNumber: `B-${randomUUID()}`,
      })),
    ], "asset collection");

    console.log(
      "offline PostgreSQL concurrency: checklist, material, and asset single-winner semantics verified",
    );
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (productId) await db.delete(products).where(eq(products.id, productId));
    await db.delete(profiles).where(eq(profiles.id, technicianId));
    clientA.release();
    clientB.release();
    await pool.end();
  }
}

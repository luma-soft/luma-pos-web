import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("maintenance PostgreSQL concurrency: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    profiles,
    projects,
    serviceMaintenanceOccurrences,
    serviceMaintenancePlans,
  } = schema;
  const { generateMaintenanceOccurrenceCore } = await import(
    `${projectRoot}/src/lib/services/maintenance-worker.ts`
  );
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = drizzle(pool, { schema });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const technicianId = randomUUID();
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

  try {
    await db.insert(profiles).values({
      id: technicianId,
      fullName: `maintenance-race-${randomUUID()}`,
      role: "technician",
    });
    const [project] = await db.insert(projects).values({
      name: `maintenance-race-${randomUUID()}`,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;
    const [plan] = await db.insert(serviceMaintenancePlans).values({
      projectId,
      serviceType: "camera",
      title: "Concurrent maintenance generation",
      intervalDays: 30,
      nextDueOn: "2026-09-01",
      assignedTo: technicianId,
    }).returning();
    const results = await Promise.all([
      transactionOn(clientA, (tx) => generateMaintenanceOccurrenceCore(
        tx, plan.id, new Date("2026-08-20T01:00:00.000Z"),
      )),
      transactionOn(clientB, (tx) => generateMaintenanceOccurrenceCore(
        tx, plan.id, new Date("2026-08-20T01:00:01.000Z"),
      )),
    ]);
    assert.equal(results.filter((item) => item.created).length, 1);
    assert.equal(new Set(results.map((item) => item.jobId)).size, 1);
    assert.equal(
      (await db.select().from(serviceMaintenanceOccurrences)
        .where(eq(serviceMaintenanceOccurrences.planId, plan.id))).length,
      1,
    );
    await db.update(serviceMaintenancePlans).set({ nextDueOn: "2026-10-01" })
      .where(eq(serviceMaintenancePlans.id, plan.id));
    await assert.rejects(
      db.transaction((tx) => generateMaintenanceOccurrenceCore(
        tx, plan.id, new Date("2026-09-20T01:00:00.000Z"),
      )),
      /SERVICE_MAINTENANCE_OUTSTANDING/,
    );
    console.log("maintenance PostgreSQL concurrency: one outstanding occurrence/job verified");
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(profiles).where(eq(profiles.id, technicianId));
    clientA.release();
    clientB.release();
    await pool.end();
  }
}

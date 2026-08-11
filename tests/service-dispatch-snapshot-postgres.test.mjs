import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;
if (!databaseUrl) {
  console.log("service dispatch snapshot PostgreSQL: skipped because DATABASE_URL is unset");
} else {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${root}/src/db/schema.ts`);
  const { profiles, projects, serviceJobs } = schema;
  const { readRepeatableSnapshot } = await import(
    `${root}/src/lib/services/consistent-read.ts`
  );
  const {
    getServiceDispatchPage,
    getServiceManagerReport,
    parseServiceDispatchQuery,
    parseServiceReportQuery,
  } = await import(`${root}/src/lib/services/dispatch-reporting.ts`);
  const fixturePool = new Pool({ connectionString: databaseUrl, max: 2 });
  const writerPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const fixtureDb = drizzle(fixturePool, { schema });
  const technicianId = randomUUID();
  let projectId;
  try {
    await fixtureDb.insert(profiles).values({
      id: technicianId,
      fullName: "Snapshot Technician",
      role: "technician",
    });
    const [project] = await fixtureDb.insert(projects).values({
      name: `snapshot-${randomUUID()}`,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;
    const [firstJob] = await fixtureDb.insert(serviceJobs).values({
      projectId,
      code: `SNP-${randomUUID().slice(0, 12)}`,
      serviceType: "camera",
      title: "Snapshot first",
      status: "scheduled",
      assignedTo: technicianId,
      scheduledAt: new Date("2045-07-29T02:00:00.000Z"),
    }).returning();

    const insertBetweenReads = (_database, reads) => readRepeatableSnapshot(fixtureDb, {
      first: async (tx) => {
        const first = await reads.first(tx);
        await writerPool.query(
        `insert into service_jobs
          (project_id, code, service_type, title, status, assigned_to, scheduled_at)
         values ($1, $2, 'camera', 'Snapshot concurrent', 'scheduled', $3, $4)`,
        [
          projectId,
          `SNP-${randomUUID().slice(0, 12)}`,
          technicianId,
          new Date("2045-07-29T03:00:00.000Z"),
        ],
        );
        return first;
      },
      second: reads.second,
    });
    const dispatch = await getServiceDispatchPage(
      parseServiceDispatchQuery(new URLSearchParams({
        from: "2045-07-29T00:00:00Z",
        to: "2045-07-30T00:00:00Z",
        technicianId,
        size: "20",
      })),
      new Date("2045-07-29T12:00:00Z"),
      insertBetweenReads,
    );
    assert.equal(dispatch.rows.length, 1);
    assert.equal(dispatch.total, 1);
    assert.equal(dispatch.pageCount, 1);

    const updateBetweenReads = (_database, reads) => readRepeatableSnapshot(fixtureDb, {
      first: async (tx) => {
        const first = await reads.first(tx);
        await writerPool.query(
          "update service_jobs set status = 'completed' where id = $1",
          [firstJob.id],
        );
        return first;
      },
      second: reads.second,
    });
    const report = await getServiceManagerReport(
      parseServiceReportQuery(new URLSearchParams({
        from: "2045-07-29T00:00:00Z",
        to: "2045-07-30T00:00:00Z",
        size: "20",
      })),
      new Date("2045-07-29T12:00:00Z"),
      updateBetweenReads,
    );
    assert.equal(report.metrics.total, 2);
    assert.equal(report.metrics.completed, 0);
    assert.equal(report.rows.length, 2);
    assert.equal(
      report.rows.find((row) => row.id === firstJob.id)?.status,
      "scheduled",
    );
    console.log("service dispatch snapshot PostgreSQL: insert/update interleavings stayed consistent");
  } finally {
    if (projectId) await fixtureDb.delete(projects).where(eq(projects.id, projectId));
    await fixtureDb.delete(profiles).where(inArray(profiles.id, [technicianId]));
    await writerPool.end();
    await fixturePool.end();
  }
}

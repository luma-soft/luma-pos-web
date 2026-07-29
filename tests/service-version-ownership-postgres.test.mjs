import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log("service version ownership PostgreSQL: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    installedAssets,
    projects,
    serviceJobs,
  } = schema;
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const db = drizzle(pool, { schema });
  const nestedClient = await pool.connect();
  let projectId;

  async function jobVersions(jobId) {
    const [row] = await db.select({
      version: serviceJobs.version,
      checklistVersion: serviceJobs.checklistVersion,
      assetsVersion: serviceJobs.assetsVersion,
    }).from(serviceJobs).where(eq(serviceJobs.id, jobId));
    return row;
  }

  try {
    const [project] = await db.insert(projects).values({
      name: `version-owner-${randomUUID()}`,
      serviceType: "camera",
      serviceStage: "active",
    }).returning();
    projectId = project.id;

    const [firstJob] = await db.insert(serviceJobs).values({
      projectId,
      code: `OWNER-${randomUUID().slice(0, 12)}`,
      serviceType: "camera",
      title: "Version owner A",
      version: 77,
      checklistVersion: 77,
      assetsVersion: 77,
    }).returning();
    assert.deepEqual(await jobVersions(firstJob.id), {
      version: 1,
      checklistVersion: 1,
      assetsVersion: 1,
    }, "explicit INSERT revisions must be normalized to one");

    await db.update(serviceJobs).set({ assetsVersion: 77 })
      .where(eq(serviceJobs.id, firstJob.id));
    await db.update(serviceJobs).set({ assetsVersion: 1 })
      .where(eq(serviceJobs.id, firstJob.id));
    await db.update(serviceJobs).set({
      assetsVersion: sql`${serviceJobs.assetsVersion} - 1`,
    }).where(eq(serviceJobs.id, firstJob.id));
    assert.equal(
      (await jobVersions(firstJob.id)).assetsVersion,
      1,
      "top-level inflate, reset, and decrement attempts must be ignored",
    );
    await nestedClient.query(
      "DROP TABLE IF EXISTS service_assets_version_probe CASCADE",
    );
    await nestedClient.query(
      "CREATE TEMP TABLE service_assets_version_probe (job_id uuid NOT NULL)",
    );
    await nestedClient.query(`
      CREATE OR REPLACE FUNCTION pg_temp.try_invalid_assets_version_delta()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        UPDATE public.service_jobs
        SET assets_version = assets_version + 2
        WHERE id = NEW.job_id;
        RETURN NEW;
      END;
      $$
    `);
    await nestedClient.query(`
      CREATE TRIGGER service_assets_version_probe_write
      BEFORE INSERT ON service_assets_version_probe
      FOR EACH ROW
      EXECUTE FUNCTION pg_temp.try_invalid_assets_version_delta()
    `);
    await assert.rejects(
      nestedClient.query(
        "INSERT INTO service_assets_version_probe (job_id) VALUES ($1)",
        [firstJob.id],
      ),
      (error) =>
        error.code === "23514"
        && error.message.includes("SERVICE_ASSETS_VERSION_INVALID_DELTA"),
      "nested writers may not apply any collection delta except exactly +1",
    );
    assert.equal((await jobVersions(firstJob.id)).assetsVersion, 1);

    await db.update(serviceJobs).set({ title: "Version owner A updated" })
      .where(eq(serviceJobs.id, firstJob.id));
    let firstVersions = await jobVersions(firstJob.id);
    assert.deepEqual(firstVersions, {
      version: 2,
      checklistVersion: 1,
      assetsVersion: 1,
    }, "canonical job changes must retain their existing revision behavior");

    const checklist = [{ code: "power", labelKey: "power", completed: true }];
    await db.update(serviceJobs).set({ checklist })
      .where(eq(serviceJobs.id, firstJob.id));
    firstVersions = await jobVersions(firstJob.id);
    assert.deepEqual(firstVersions, {
      version: 3,
      checklistVersion: 2,
      assetsVersion: 1,
    }, "checklist changes must advance job and checklist exactly once");

    const [secondJob] = await db.insert(serviceJobs).values({
      projectId,
      code: `OWNER-${randomUUID().slice(0, 12)}`,
      serviceType: "camera",
      title: "Version owner B",
    }).returning();
    const [asset] = await db.insert(installedAssets).values({
      projectId,
      jobId: firstJob.id,
      assetKind: "camera",
      name: "Owned camera",
      ipAddress: "192.0.2.30",
    }).returning();
    assert.equal((await jobVersions(firstJob.id)).assetsVersion, 2);
    await db.update(serviceJobs).set({ assetsVersion: 1 })
      .where(eq(serviceJobs.id, firstJob.id));
    await db.update(serviceJobs).set({
      assetsVersion: sql`${serviceJobs.assetsVersion} - 1`,
    }).where(eq(serviceJobs.id, firstJob.id));
    await db.update(serviceJobs).set({ assetsVersion: 77 })
      .where(eq(serviceJobs.id, firstJob.id));
    assert.equal(
      (await jobVersions(firstJob.id)).assetsVersion,
      2,
      "top-level reset, decrement, and inflate attempts cannot alter an advanced collection",
    );

    await db.update(installedAssets).set({ updatedAt: new Date() })
      .where(eq(installedAssets.id, asset.id));
    assert.equal(
      (await jobVersions(firstJob.id)).assetsVersion,
      2,
      "asset housekeeping updates must not advance the collection",
    );

    await db.update(installedAssets).set({ ipAddress: "192.0.2.31" })
      .where(eq(installedAssets.id, asset.id));
    assert.equal((await jobVersions(firstJob.id)).assetsVersion, 3);

    await db.update(installedAssets).set({ jobId: secondJob.id })
      .where(eq(installedAssets.id, asset.id));
    assert.equal((await jobVersions(firstJob.id)).assetsVersion, 4);
    assert.equal((await jobVersions(secondJob.id)).assetsVersion, 2);

    await db.delete(installedAssets).where(eq(installedAssets.id, asset.id));
    assert.equal((await jobVersions(secondJob.id)).assetsVersion, 3);

    console.log(
      "service version ownership PostgreSQL: direct writes normalized and collection bumps exact",
    );
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    nestedClient.release();
    await pool.end();
  }
}

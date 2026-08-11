import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;
if (!databaseUrl) {
  console.log("service version ownership PostgreSQL: skipped because DATABASE_URL is unset");
} else {
  const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const schema = await import(`${projectRoot}/src/db/schema.ts`);
  const {
    installedAssets,
    products,
    projects,
    serviceJobMaterials,
    serviceJobs,
  } = schema;
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = drizzle(pool, { schema });
  const nestedClient = await pool.connect();
  let projectId;
  let productId;

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
    const [product] = await db.insert(products).values({
      name: `Version owner product ${randomUUID()}`,
      sku: `VERSION-OWNER-${randomUUID()}`,
      unit: "pcs",
    }).returning();
    productId = product.id;

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
    await nestedClient.query("BEGIN");
    try {
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
          SET assets_version = assets_version + 1
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
      await nestedClient.query(
        "INSERT INTO service_assets_version_probe (job_id) VALUES ($1)",
        [firstJob.id],
      );
      const nestedVersion = await nestedClient.query(
        "SELECT assets_version FROM service_jobs WHERE id = $1",
        [firstJob.id],
      );
      assert.equal(
        nestedVersion.rows[0].assets_version,
        1,
        "an unrelated nested +1 write must remain ineffective",
      );
    } finally {
      await nestedClient.query("ROLLBACK");
    }

    const [material] = await db.insert(serviceJobMaterials).values({
      jobId: firstJob.id,
      productId,
      unitName: "pcs",
      plannedQuantity: "1",
      version: 77,
    }).returning();
    assert.equal(material.version, 1, "material INSERT versions are database-owned");

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
      productId,
      assetKind: "camera",
      name: "Owned camera",
      ipAddress: "192.0.2.30",
      version: 77,
    }).returning();
    assert.equal(asset.version, 1, "installed-asset INSERT versions are database-owned");
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

    const [concurrentJob] = await db.insert(serviceJobs).values({
      projectId,
      code: `OWNER-${randomUUID().slice(0, 12)}`,
      serviceType: "camera",
      title: "Concurrent collection owner",
    }).returning();
    await Promise.all([
      db.insert(installedAssets).values({
        projectId,
        jobId: concurrentJob.id,
        assetKind: "camera",
        name: "Concurrent camera A",
      }),
      db.insert(installedAssets).values({
        projectId,
        jobId: concurrentJob.id,
        assetKind: "camera",
        name: "Concurrent camera B",
      }),
    ]);
    assert.equal(
      (await jobVersions(concurrentJob.id)).assetsVersion,
      3,
      "concurrent collection inserts must serialize without losing a bump",
    );

    async function assertServiceRoleDenied(statement) {
      await nestedClient.query("BEGIN");
      try {
        await nestedClient.query("SET LOCAL ROLE service_role");
        await assert.rejects(
          nestedClient.query(statement, [firstJob.id]),
          (error) => error.code === "42501",
        );
      } finally {
        await nestedClient.query("ROLLBACK");
      }
    }
    await assertServiceRoleDenied(
      "SELECT version FROM service_job_asset_revisions WHERE job_id = $1",
    );
    await assertServiceRoleDenied(
      "UPDATE service_job_asset_revisions SET version = 77 WHERE job_id = $1",
    );
    await nestedClient.query("BEGIN");
    try {
      await nestedClient.query("SET LOCAL ROLE service_role");
      const mirroredVersion = await nestedClient.query(
        "SELECT assets_version FROM service_jobs WHERE id = $1",
        [firstJob.id],
      );
      assert.equal(mirroredVersion.rows[0].assets_version, 4);
    } finally {
      await nestedClient.query("ROLLBACK");
    }
    await nestedClient.query("BEGIN");
    try {
      await nestedClient.query("SET LOCAL ROLE service_role");
      const serviceRoleJob = await nestedClient.query(
        `INSERT INTO service_jobs
          (project_id, code, service_type, title, version,
           checklist_version, assets_version)
         VALUES ($1, $2, 'camera', 'Service-role job probe', 77, 77, 77)
         RETURNING version, checklist_version, assets_version`,
        [projectId, `ROLE-${randomUUID().slice(0, 12)}`],
      );
      assert.deepEqual(serviceRoleJob.rows[0], {
        version: 1,
        checklist_version: 1,
        assets_version: 1,
      });
    } finally {
      await nestedClient.query("ROLLBACK");
    }
    await nestedClient.query("BEGIN");
    try {
      await nestedClient.query("SET LOCAL ROLE service_role");
      await nestedClient.query(
        `INSERT INTO installed_assets
          (project_id, job_id, asset_kind, name)
         VALUES ($1, $2, 'camera', 'Service-role trigger probe')`,
        [projectId, concurrentJob.id],
      );
      const serviceRoleBump = await nestedClient.query(
        "SELECT assets_version FROM service_jobs WHERE id = $1",
        [concurrentJob.id],
      );
      assert.equal(
        serviceRoleBump.rows[0].assets_version,
        4,
        "revoked helper execution must not prevent its installed-assets trigger path",
      );
    } finally {
      await nestedClient.query("ROLLBACK");
    }

    console.log(
      "service version ownership PostgreSQL: direct writes normalized and collection bumps exact",
    );
  } finally {
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (productId) await db.delete(products).where(eq(products.id, productId));
    nestedClient.release();
    await pool.end();
  }
}

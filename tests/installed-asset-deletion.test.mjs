import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import { deleteInstalledAssetCore } from "../src/lib/services/delete-installed-asset.ts";

const { projects, installedAssets, serviceAttachments, serviceJobs,
  serviceMaintenancePlans, warrantyClaims, mediaObjects, orders } = schema;
const storeId = "00000000-0000-4000-8000-000000000001";
const otherStoreId = "00000000-0000-4000-8000-000000000002";
const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync("drizzle").filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim() && !/create extension|gin_trgm_ops/i.test(statement)) await client.exec(statement);
    }
  }
}, 30000);
afterAll(() => client.close());

async function fixture({ job = false } = {}) {
  const [project] = await database.insert(projects).values({ storeId, name: "Nhà khách", serviceType: "camera" }).returning();
  const [work] = job ? await database.insert(serviceJobs).values({
    storeId, projectId: project.id, code: crypto.randomUUID().slice(0, 20),
    title: "Lắp camera", serviceType: "camera", status: "in_progress",
  }).returning() : [];
  const [asset] = await database.insert(installedAssets).values({
    storeId, projectId: project.id, jobId: work?.id, assetKind: "camera", name: "Camera cửa",
  }).returning();
  return { project, asset, work };
}

async function photo(project, asset, jobId) {
  const [media] = await database.insert(mediaObjects).values({
    storeId, provider: "r2", visibility: "private", purpose: "project-document",
    targetId: project.id, domain: "projects", bucket: "luma-private",
    objectKey: `projects/${crypto.randomUUID()}.jpg`, originalFileName: "Camera.jpg",
    mimeType: "image/jpeg", sizeBytes: 128, sha256: "a".repeat(64),
    status: "ready", uploadExpiresAt: new Date(), readyAt: new Date(), verifiedAt: new Date(),
  }).returning();
  const [attachment] = await database.insert(serviceAttachments).values({
    storeId, projectId: project.id, assetId: asset.id, jobId,
    category: "asset", isPrimary: true, bucket: media.bucket, path: media.objectKey,
    fileName: "Camera.jpg", mimeType: "image/jpeg", sizeBytes: 128, mediaObjectId: media.id,
  }).returning();
  return { media, attachment };
}

describe("installed device deletion", () => {
  test("deletes only the requested device and retains photos, project and orders", async () => {
    const { project, asset } = await fixture();
    const unrelated = await fixture();
    const { attachment, media } = await photo(project, asset);
    const [order] = await database.insert(orders).values({ storeId, code: "DH-ASSET-DELETE", projectId: project.id }).returning();
    expect(await deleteInstalledAssetCore(database, { storeId, assetId: asset.id })).toEqual({ outcome: "deleted", projectId: project.id });
    expect(await database.select().from(installedAssets).where(eq(installedAssets.id, asset.id))).toHaveLength(0);
    expect(await database.select().from(installedAssets).where(eq(installedAssets.id, unrelated.asset.id))).toHaveLength(1);
    expect(await database.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
    const [kept] = await database.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id));
    expect(kept).toMatchObject({ assetId: null, isPrimary: false, category: "after", projectPhase: "after_installation", mediaObjectId: media.id, deletedAt: null });
    const [keptMedia] = await database.select().from(mediaObjects).where(eq(mediaObjects.id, media.id));
    expect(keptMedia.status).toBe("ready");
    expect(await database.select().from(orders).where(eq(orders.id, order.id))).toEqual([order]);
  });

  test("rejects another store and a missing device without changing data", async () => {
    const { asset } = await fixture();
    expect(await deleteInstalledAssetCore(database, { storeId: otherStoreId, assetId: asset.id })).toEqual({ outcome: "not_found" });
    expect(await deleteInstalledAssetCore(database, { storeId, assetId: crypto.randomUUID() })).toEqual({ outcome: "not_found" });
    expect(await database.select().from(installedAssets).where(eq(installedAssets.id, asset.id))).toHaveLength(1);
  });

  test("deletes a device on an active work order and retains its evidence", async () => {
    const { project, asset, work } = await fixture({ job: true });
    const { attachment } = await photo(project, asset, work.id);
    expect(await deleteInstalledAssetCore(database, { storeId, assetId: asset.id })).toEqual({ outcome: "deleted", projectId: project.id });
    const [kept] = await database.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id));
    expect(kept).toMatchObject({ jobId: work.id, assetId: null, category: "after" });
    const [job] = await database.select().from(serviceJobs).where(eq(serviceJobs.id, work.id));
    expect(job.status).toBe("in_progress");
    expect(job.assetsVersion).toBeGreaterThan(work.assetsVersion);
  });

  test("preserves devices with maintenance or warranty history", async () => {
    const { project, asset } = await fixture();
    await database.insert(serviceMaintenancePlans).values({ storeId, projectId: project.id, assetId: asset.id, serviceType: "camera", title: "Bảo trì", intervalDays: 30, nextDueOn: "2026-10-01" });
    expect(await deleteInstalledAssetCore(database, { storeId, assetId: asset.id })).toEqual({ outcome: "linked" });
    const warranty = await fixture({ job: true });
    await database.insert(warrantyClaims).values({ storeId, projectId: warranty.project.id, jobId: warranty.work.id, assetId: warranty.asset.id, code: "BH-ASSET-DELETE", title: "Mất hình" });
    expect(await deleteInstalledAssetCore(database, { storeId, assetId: warranty.asset.id })).toEqual({ outcome: "linked" });
    expect(await database.select().from(installedAssets).where(eq(installedAssets.id, warranty.asset.id))).toHaveLength(1);
  });

  test.each(["completed", "cancelled"])("rolls back photo changes for a %s work order", async (status) => {
    const { project, asset, work } = await fixture({ job: true });
    const { attachment } = await photo(project, asset);
    await database.update(serviceJobs).set({ status }).where(eq(serviceJobs.id, work.id));
    await expect(deleteInstalledAssetCore(database, { storeId, assetId: asset.id })).rejects.toThrow();
    expect(await database.select().from(installedAssets).where(eq(installedAssets.id, asset.id))).toHaveLength(1);
    const [kept] = await database.select().from(serviceAttachments).where(eq(serviceAttachments.id, attachment.id));
    expect(kept).toMatchObject({ assetId: asset.id, isPrimary: true, category: "asset" });
  });
});

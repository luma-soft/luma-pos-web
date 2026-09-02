import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  mediaObjects,
  orders,
  installedAssets,
  profiles,
  projects,
  serviceAttachments,
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
  serviceHandoverDocumentMedia,
  serviceHandoverDocuments,
  serviceJobs,
  serviceSignatures,
  serviceCustomerRequestStorageCleanup,
} = schema;
const { deleteProjectCore } = await import(
  `${projectRoot}/src/lib/projects/delete-project.ts`
);

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "91111111-1111-4111-8111-111111111111";
const PROJECT_ID = "92222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID = "93333333-3333-4333-8333-333333333333";
const JOB_ID = "94444444-4444-4444-8444-444444444444";
const DOCUMENT_ID = "95555555-5555-4555-8555-555555555555";
const REQUEST_ID = "96666666-6666-4666-8666-666666666666";
const ASSET_ID = "96777777-7777-4777-8777-777777777777";
const PROJECT_MEDIA_ID = "97777777-7777-4777-8777-777777777777";
const JOB_MEDIA_ID = "98888888-8888-4888-8888-888888888888";
const REQUEST_MEDIA_ID = "99999999-9999-4999-8999-999999999999";
const PENDING_MEDIA_ID = "9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNRELATED_MEDIA_ID = "9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-03T08:00:00.000Z");
const previousSupabaseUrl = process.env.SUPABASE_URL;

const client = new PGlite();
const database = drizzle(client, { schema });

async function applySqlFile(path) {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) {
      await client.exec(statement);
    }
  }
}

function mediaValue({
  id,
  purpose,
  targetId,
  provider = "r2",
  status = "ready",
}) {
  return {
    id,
    storeId: STORE_ID,
    provider,
    visibility: "private",
    purpose,
    targetId,
    domain: "projects",
    bucket: provider === "r2" ? "luma-private" : "legacy-projects",
    objectKey: `stores/${STORE_ID}/projects/${id}/original.jpg`,
    originalFileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 128,
    sha256: "a".repeat(64),
    status,
    uploadExpiresAt: new Date("2026-09-03T09:00:00.000Z"),
    readyAt: status === "ready" ? NOW : null,
    verifiedAt: status === "ready" ? NOW : null,
  };
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://legacy.supabase.co";
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${file}`);
  }
  await database.insert(profiles).values({
    id: ACTOR_ID,
    fullName: "Project deletion manager",
    role: "manager",
  });
});

afterAll(async () => {
  if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousSupabaseUrl;
  await client.close();
});

describe("project deletion", () => {
  test("deletes the complete project tree, tombstones managed media, and queues legacy storage", async () => {
    await database.insert(projects).values([
      {
        id: PROJECT_ID,
        name: "Công trình cần xóa",
        serviceType: "camera",
        serviceStage: "active",
      },
      {
        id: OTHER_PROJECT_ID,
        name: "Công trình giữ lại",
        serviceType: "camera",
        serviceStage: "active",
      },
    ]);
    await database.insert(orders).values({
      code: "DH-DELETE-PROJECT",
      projectId: PROJECT_ID,
      projectName: "Công trình cần xóa",
    });
    await database.insert(serviceJobs).values({
      id: JOB_ID,
      projectId: PROJECT_ID,
      code: "JOB-DELETE-PROJECT",
      serviceType: "camera",
      title: "Thi công camera",
      status: "in_progress",
      checklist: [],
    });
    await database.insert(serviceHandoverDocuments).values({
      id: DOCUMENT_ID,
      projectId: PROJECT_ID,
      jobId: JOB_ID,
      type: "handover",
      title: "Biên bản bàn giao",
      photoUrls: [
        `https://legacy.supabase.co/storage/v1/object/public/service-evidence/projects/${PROJECT_ID}/handover-legacy.jpg`,
        "https://example.com/customer-owned-photo.jpg",
      ],
    });
    await database.insert(serviceCustomerRequests).values({
      id: REQUEST_ID,
      code: "REQ-DELETE-PROJECT",
      projectId: PROJECT_ID,
      title: "Yêu cầu bảo hành",
      contactName: "Khách hàng",
      tokenHash: "b".repeat(64),
      tokenExpiresAt: new Date("2026-09-04T08:00:00.000Z"),
    });
    await database.insert(installedAssets).values({
      id: ASSET_ID,
      projectId: PROJECT_ID,
      jobId: JOB_ID,
      assetKind: "camera",
      name: "Camera cửa chính",
    });
    await database.insert(mediaObjects).values([
      mediaValue({
        id: PROJECT_MEDIA_ID,
        purpose: "project-document",
        targetId: PROJECT_ID,
      }),
      mediaValue({
        id: JOB_MEDIA_ID,
        purpose: "service-evidence",
        targetId: JOB_ID,
      }),
      mediaValue({
        id: REQUEST_MEDIA_ID,
        purpose: "project-document",
        targetId: PROJECT_ID,
        provider: "supabase",
      }),
      mediaValue({
        id: PENDING_MEDIA_ID,
        purpose: "project-document",
        targetId: PROJECT_ID,
        status: "pending",
      }),
      mediaValue({
        id: UNRELATED_MEDIA_ID,
        purpose: "project-document",
        targetId: OTHER_PROJECT_ID,
      }),
    ]);
    const [projectAttachment, jobAttachment] = await database
      .insert(serviceAttachments)
      .values([
        {
          projectId: PROJECT_ID,
          mediaObjectId: PROJECT_MEDIA_ID,
          projectPhase: "handover",
          category: "document",
          bucket: "luma-private",
          path: `projects/${PROJECT_ID}/handover.jpg`,
          fileName: "handover.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 128,
          sha256: "a".repeat(64),
        },
        {
          projectId: PROJECT_ID,
          jobId: JOB_ID,
          mediaObjectId: JOB_MEDIA_ID,
          category: "after",
          bucket: "luma-private",
          path: `projects/${PROJECT_ID}/job-after.jpg`,
          fileName: "job-after.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 128,
          sha256: "a".repeat(64),
        },
        {
          projectId: PROJECT_ID,
          jobId: JOB_ID,
          category: "before",
          bucket: "service-evidence",
          path: `projects/${PROJECT_ID}/legacy-before.jpg`,
          fileName: "legacy-before.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 128,
        },
        {
          projectId: PROJECT_ID,
          jobId: JOB_ID,
          assetId: ASSET_ID,
          mediaObjectId: PROJECT_MEDIA_ID,
          category: "asset",
          bucket: "luma-private",
          path: `projects/${PROJECT_ID}/asset.jpg`,
          fileName: "asset.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 128,
          isPrimary: true,
        },
      ])
      .returning();
    await database.insert(serviceHandoverDocumentMedia).values({
      documentId: DOCUMENT_ID,
      mediaObjectId: PROJECT_MEDIA_ID,
    });
    await database.insert(serviceSignatures).values({
      projectId: PROJECT_ID,
      jobId: JOB_ID,
      documentId: DOCUMENT_ID,
      attachmentId: jobAttachment.id,
      signerName: "Khách hàng",
      documentHash: "c".repeat(64),
    });
    await database.insert(serviceCustomerRequestAttachments).values({
      requestId: REQUEST_ID,
      mediaObjectId: REQUEST_MEDIA_ID,
      bucket: "legacy-projects",
      path: `projects/${PROJECT_ID}/request.jpg`,
      fileName: "request.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 128,
      width: 100,
      height: 100,
      sha256: "d".repeat(64),
    });
    await database
      .update(serviceJobs)
      .set({ status: "completed" })
      .where(eq(serviceJobs.id, JOB_ID));

    const deletion = await deleteProjectCore(database, {
      storeId: STORE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      deletedAt: NOW,
    });
    expect(deletion).toEqual({
      outcome: "deleted",
      projectId: PROJECT_ID,
      managedMediaCount: 4,
      legacyObjectCount: 2,
    });

    expect(await database.select().from(projects).where(eq(projects.id, PROJECT_ID)))
      .toHaveLength(0);
    expect(await database.select().from(projects).where(eq(projects.id, OTHER_PROJECT_ID)))
      .toHaveLength(1);
    expect(await database.select().from(serviceAttachments).where(eq(
      serviceAttachments.projectId,
      PROJECT_ID,
    ))).toHaveLength(0);
    expect(await database.select().from(serviceHandoverDocuments).where(eq(
      serviceHandoverDocuments.id,
      DOCUMENT_ID,
    ))).toHaveLength(0);
    expect(await database.select().from(installedAssets).where(eq(
      installedAssets.id,
      ASSET_ID,
    ))).toHaveLength(0);
    expect(await database.select().from(serviceCustomerRequests).where(eq(
      serviceCustomerRequests.id,
      REQUEST_ID,
    ))).toHaveLength(0);

    const [preservedOrder] = await database.select().from(orders).where(eq(
      orders.code,
      "DH-DELETE-PROJECT",
    ));
    expect(preservedOrder).toMatchObject({
      projectId: null,
      projectName: "Công trình cần xóa",
    });

    const deletedMedia = await database.select().from(mediaObjects).where(and(
      eq(mediaObjects.storeId, STORE_ID),
      eq(mediaObjects.targetId, PROJECT_ID),
    ));
    expect(deletedMedia).toHaveLength(3);
    expect(deletedMedia.every((media) =>
      media.status === "deleted" && media.deletedAt?.getTime() === NOW.getTime()
    )).toBe(true);
    expect((await database.select().from(mediaObjects).where(eq(
      mediaObjects.id,
      JOB_MEDIA_ID,
    )))[0]).toMatchObject({ status: "deleted", deletedAt: NOW });
    expect((await database.select().from(mediaObjects).where(eq(
      mediaObjects.id,
      UNRELATED_MEDIA_ID,
    )))[0]).toMatchObject({ status: "ready", deletedAt: null });

    expect(await database.select({
      bucket: serviceCustomerRequestStorageCleanup.bucket,
      path: serviceCustomerRequestStorageCleanup.path,
    }).from(serviceCustomerRequestStorageCleanup)).toEqual([
      {
        bucket: "legacy-projects",
        path: `stores/${STORE_ID}/projects/${REQUEST_MEDIA_ID}/original.jpg`,
      },
      {
        bucket: "service-evidence",
        path: `projects/${PROJECT_ID}/handover-legacy.jpg`,
      },
      {
        bucket: "service-evidence",
        path: `projects/${PROJECT_ID}/legacy-before.jpg`,
      },
    ]);

    expect(projectAttachment.id).toBeTruthy();
  });

  test("is tenant-scoped and reports missing projects without mutating data", async () => {
    await expect(deleteProjectCore(database, {
      storeId: "f1111111-1111-4111-8111-111111111111",
      projectId: OTHER_PROJECT_ID,
      actorId: ACTOR_ID,
      deletedAt: NOW,
    })).resolves.toEqual({ outcome: "not_found" });

    expect(await database.select().from(projects).where(eq(
      projects.id,
      OTHER_PROJECT_ID,
    ))).toHaveLength(1);
  });
});

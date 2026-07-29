import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  installedAssets,
  profiles,
  projects,
  serviceAttachments,
  serviceJobEvents,
  serviceJobs,
  serviceSignatures,
} = schema;
const {
  completeFieldServiceJobCore,
  createServiceSignatureCore,
} = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
const {
  canonicalizeSignedDocument,
} = await import(`${projectRoot}/src/lib/services/evidence.ts`);
const {
  serviceSignatureSchema,
} = await import(`${projectRoot}/src/lib/services/schemas.ts`);

const client = new PGlite();
const db = drizzle(client, { schema });
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const technicianId = "22222222-2222-4222-8222-222222222222";
await db.insert(profiles).values({
  id: technicianId,
  fullName: "Kỹ thuật viên Bình",
  role: "technician",
});
const actor = { userId: technicianId, role: "technician" };

const parsedClientPayload = serviceSignatureSchema.parse({
  jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  attachmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  signerName: "Khách hàng",
  clientMutationId: "snapshot-schema-forged",
  document: { project: "forged", assets: ["forged"] },
});
assert.equal("document" in parsedClientPayload, false);
assert.equal("documentId" in parsedClientPayload, false);

async function createFixture(code) {
  const [project] = await db.insert(projects).values({
    name: `Công trình ${code}`,
    address: "12 Nguyễn Huệ",
    serviceType: "camera",
    serviceStage: "active",
    siteContactName: "Chị Lan",
    siteContactPhone: "0909000000",
  }).returning();
  const [job] = await db.insert(serviceJobs).values({
    projectId: project.id,
    code,
    serviceType: "camera",
    title: "Lắp camera kho",
    description: "Hai mắt camera",
    status: "in_progress",
    assignedTo: technicianId,
    checklist: [
      { code: "power", labelKey: "services.checklist.camera.power", completed: true },
    ],
  }).returning();
  const [asset] = await db.insert(installedAssets).values({
    projectId: project.id,
    jobId: job.id,
    assetKind: "camera",
    name: "Camera cửa kho",
    brand: "EZVIZ",
    model: "H8C",
    serialNumber: `SN-${code}`,
    macAddress: "AA:BB:CC:DD:EE:FF",
    ipAddress: "192.168.1.88",
    locationLabel: "Cửa kho",
    createdBy: technicianId,
  }).returning();
  const attachments = [];
  for (const category of ["before", "after", "signature"]) {
    const [attachment] = await db.insert(serviceAttachments).values({
      projectId: project.id,
      jobId: job.id,
      category,
      bucket: "service-evidence",
      path: `${project.id}/${job.id}/${category}.png`,
      fileName: `${category}.png`,
      mimeType: "image/png",
      sizeBytes: 100,
      sha256: createHash("sha256").update(category).digest("hex"),
      createdBy: technicianId,
    }).returning();
    attachments.push(attachment);
  }
  return {
    project,
    job,
    asset,
    signatureAttachment: attachments.find((item) => item.category === "signature"),
  };
}

async function signFixture(fixture, mutationSuffix) {
  return db.transaction((tx) => createServiceSignatureCore(tx, actor, {
    jobId: fixture.job.id,
    attachmentId: fixture.signatureAttachment.id,
    signerName: "Khách hàng Nguyễn Văn A",
    signerRole: "customer",
    clientMutationId: `snapshot-sign-${mutationSuffix}`,
    document: {
      accepted: false,
      project: { id: "forged-project", name: "FORGED" },
      checklist: [{ code: "power", completed: false }],
      assets: [{ id: "forged-asset", ipAddress: "8.8.8.8" }],
    },
  }, new Date("2026-07-29T03:00:00.000Z")));
}

const canonicalFixture = await createFixture("DV-SNAPSHOT-1");
const signed = await signFixture(canonicalFixture, "canonical");
const [persistedSignature] = await db.select().from(serviceSignatures)
  .where(eq(serviceSignatures.id, signed.signatureId));

assert.equal(persistedSignature.snapshotSchemaVersion, 1);
assert.equal(persistedSignature.canonicalSnapshot.project.id, canonicalFixture.project.id);
assert.equal(persistedSignature.canonicalSnapshot.project.name, canonicalFixture.project.name);
assert.equal(persistedSignature.canonicalSnapshot.job.id, canonicalFixture.job.id);
assert.equal(persistedSignature.canonicalSnapshot.job.checklist[0].completed, true);
assert.equal(persistedSignature.canonicalSnapshot.assets[0].id, canonicalFixture.asset.id);
assert.equal(persistedSignature.canonicalSnapshot.assets[0].serialNumber, "SN-DV-SNAPSHOT-1");
assert.equal(persistedSignature.canonicalSnapshot.assets[0].macAddress, "AA:BB:CC:DD:EE:FF");
assert.equal(persistedSignature.canonicalSnapshot.assets[0].ipAddress, "192.168.1.88");
assert.equal(persistedSignature.canonicalSnapshot.assets[0].locationLabel, "Cửa kho");
assert.equal(persistedSignature.canonicalSnapshot.signer.signedByProfileId, technicianId);
assert.equal(persistedSignature.canonicalSnapshot.signedAt, "2026-07-29T03:00:00.000Z");
assert.equal("document" in persistedSignature.evidence, false);
assert.equal(
  persistedSignature.documentHash,
  createHash("sha256")
    .update(canonicalizeSignedDocument(persistedSignature.canonicalSnapshot))
    .digest("hex"),
);

await db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
  jobId: canonicalFixture.job.id,
  clientMutationId: "snapshot-complete-valid",
  completionNote: "Đã bàn giao đúng snapshot",
}, new Date("2026-07-29T03:10:00.000Z")));

const staleFixture = await createFixture("DV-SNAPSHOT-2");
const staleSigned = await signFixture(staleFixture, "stale");
await db.update(installedAssets).set({
  ipAddress: "192.168.1.99",
  updatedAt: new Date("2026-07-29T03:05:00.000Z"),
}).where(eq(installedAssets.id, staleFixture.asset.id));
const [invalidated] = await db.select().from(serviceSignatures)
  .where(eq(serviceSignatures.id, staleSigned.signatureId));
assert.ok(invalidated.invalidatedAt);
assert.equal(invalidated.invalidationReason, "asset.changed");
const invalidationEvents = await db.select().from(serviceJobEvents)
  .where(eq(serviceJobEvents.jobId, staleFixture.job.id));
assert.ok(invalidationEvents.some((item) => item.eventType === "job.signature_invalidated"));
await assert.rejects(
  db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
    jobId: staleFixture.job.id,
    clientMutationId: "snapshot-complete-stale",
    completionNote: "Không được hoàn tất",
  })),
  /SERVICE_SIGNATURE_STALE/,
);

const tamperedFixture = await createFixture("DV-SNAPSHOT-3");
const tamperedSigned = await signFixture(tamperedFixture, "tampered");
await db.update(serviceSignatures).set({
  documentHash: "f".repeat(64),
}).where(eq(serviceSignatures.id, tamperedSigned.signatureId));
await assert.rejects(
  db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
    jobId: tamperedFixture.job.id,
    clientMutationId: "snapshot-complete-tampered",
    completionNote: "Không được hoàn tất",
  })),
  /SERVICE_SIGNATURE_HASH_INVALID/,
);

const ownershipFixture = await createFixture("DV-SNAPSHOT-4");
const ownershipSigned = await signFixture(ownershipFixture, "ownership");
const [foreignProject] = await db.insert(projects).values({ name: "Dự án khác" }).returning();
await db.update(serviceSignatures).set({
  projectId: foreignProject.id,
}).where(eq(serviceSignatures.id, ownershipSigned.signatureId));
await assert.rejects(
  db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
    jobId: ownershipFixture.job.id,
    clientMutationId: "snapshot-complete-ownership",
    completionNote: "Không được hoàn tất",
  })),
  /SERVICE_SIGNATURE_OWNERSHIP_INVALID/,
);

console.log("server-owned signed snapshots: canonical authority, integrity, freshness, and ownership verified");

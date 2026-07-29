import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  profiles,
  projects,
  serviceAttachments,
  serviceFieldMutations,
  serviceJobs,
  serviceSignatures,
  serviceVisits,
} = schema;
const {
  checkInServiceVisitCore,
  checkOutServiceVisitCore,
  completeFieldServiceJobCore,
  createServiceSignatureCore,
  updateFieldChecklistCore,
} = await import(`${projectRoot}/src/lib/services/field-operations.ts`);
const { createDefaultChecklist } = await import(`${projectRoot}/src/lib/services/domain.ts`);

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const technicianId = "11111111-1111-4111-8111-111111111111";
await db.insert(profiles).values({
  id: technicianId,
  fullName: "Kỹ thuật viên An",
  role: "technician",
});
const [project] = await db.insert(projects).values({
  name: "Camera kho",
  serviceType: "camera",
  serviceStage: "active",
}).returning();
const [job] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-FIELD-1",
  serviceType: "camera",
  title: "Lắp camera",
  status: "scheduled",
  assignedTo: technicianId,
  checklist: createDefaultChecklist("camera"),
}).returning();
const actor = { userId: technicianId, role: "technician" };
const [persistedJob] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, job.id));
if (persistedJob.assignedTo !== technicianId) {
  throw new Error(`primary assignment was not persisted: ${persistedJob.assignedTo}`);
}

const firstCheckIn = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: job.id,
  clientMutationId: "field-check-in-0001",
  latitude: 10.7769,
  longitude: 106.7009,
}, new Date("2026-07-29T01:00:00.000Z")));
const replayCheckIn = await db.transaction((tx) => checkInServiceVisitCore(tx, actor, {
  jobId: job.id,
  clientMutationId: "field-check-in-0001",
  latitude: 10.7769,
  longitude: 106.7009,
}, new Date("2026-07-29T01:05:00.000Z")));
if (firstCheckIn.visitId !== replayCheckIn.visitId) throw new Error("check-in replay changed result");

let visits = await db.select().from(serviceVisits).where(eq(serviceVisits.jobId, job.id));
if (visits.length !== 1 || visits[0].status !== "active") throw new Error("idempotent check-in failed");
const mutations = await db.select().from(serviceFieldMutations)
  .where(and(eq(serviceFieldMutations.actorId, technicianId), eq(serviceFieldMutations.jobId, job.id)));
if (mutations.length !== 1) throw new Error("check-in mutation was not tracked");

await db.transaction((tx) => updateFieldChecklistCore(tx, actor, {
  jobId: job.id,
  clientMutationId: "field-checklist-0001",
  expectedVersion: 1,
  checklist: createDefaultChecklist("camera").map((item) => ({ ...item, completed: true })),
}, new Date("2026-07-29T01:30:00.000Z")));

await db.transaction((tx) => checkOutServiceVisitCore(tx, actor, {
  jobId: job.id,
  clientMutationId: "field-check-out-0001",
}, new Date("2026-07-29T02:00:00.000Z")));
visits = await db.select().from(serviceVisits).where(eq(serviceVisits.jobId, job.id));
if (visits[0].status !== "completed" || !visits[0].checkedOutAt) throw new Error("check-out failed");

let completionError = "";
try {
  await db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
    jobId: job.id,
    clientMutationId: "field-complete-0001",
    completionNote: "Đã bàn giao",
  }, new Date("2026-07-29T02:10:00.000Z")));
} catch (error) {
  completionError = error instanceof Error ? error.message : "";
}
if (!completionError.includes("beforeEvidenceRequired")) {
  throw new Error(`completion did not enforce evidence: ${completionError}`);
}

const [before] = await db.insert(serviceAttachments).values({
  projectId: project.id,
  jobId: job.id,
  category: "before",
  bucket: "service-evidence",
  path: `${project.id}/${job.id}/before.jpg`,
  fileName: "before.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 100,
  createdBy: technicianId,
}).returning();
await db.insert(serviceAttachments).values({
  projectId: project.id,
  jobId: job.id,
  category: "after",
  bucket: "service-evidence",
  path: `${project.id}/${job.id}/after.jpg`,
  fileName: "after.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 100,
  createdBy: technicianId,
});
const [signatureAttachment] = await db.insert(serviceAttachments).values({
  projectId: project.id,
  jobId: job.id,
  category: "signature",
  bucket: "service-evidence",
  path: `${project.id}/${job.id}/signature.png`,
  fileName: "signature.png",
  mimeType: "image/png",
  sizeBytes: 100,
  createdBy: technicianId,
}).returning();
await db.transaction((tx) => createServiceSignatureCore(tx, actor, {
  jobId: job.id,
  attachmentId: signatureAttachment.id,
  signerName: "Khách hàng",
  document: { accepted: true, jobCode: job.code },
  clientMutationId: "field-signature-0001",
}, new Date("2026-07-29T02:12:00.000Z")));

await db.transaction((tx) => completeFieldServiceJobCore(tx, actor, {
  jobId: job.id,
  clientMutationId: "field-complete-0002",
  completionNote: "Đã bàn giao",
}, new Date("2026-07-29T02:15:00.000Z")));
const [completed] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, job.id));
if (completed.status !== "completed" || completed.completionNote !== "Đã bàn giao") {
  throw new Error("field completion did not update the job");
}

console.log("field operations: assignment, idempotency, visit, checklist, evidence, and completion verified");

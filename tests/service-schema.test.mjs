import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  installedAssets,
  projects,
  serviceCameraVaults,
  serviceCoordinationPoints,
  serviceJobDependencies,
  serviceJobs,
  serviceJobTradeRecords,
  serviceCostEntries,
  serviceHandoverDocuments,
  serviceMaintenancePlans,
} = schema;
const { createDefaultChecklist } = await import(
  `${projectRoot}/src/lib/services/domain.ts`
);

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");

for (const file of readdirSync(`${projectRoot}/drizzle`)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const statements = readFileSync(`${projectRoot}/drizzle/${file}`, "utf8")
    .split("--> statement-breakpoint");
  for (const statement of statements) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const [project] = await db.insert(projects).values({
  name: "Camera kho Bình Tân",
  serviceType: "camera",
  serviceStage: "planning",
}).returning();

const [job] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-0001",
  serviceType: "camera",
  title: "Lắp đặt 8 camera",
  checklist: createDefaultChecklist("camera"),
}).returning();

const [secondJob] = await db.insert(serviceJobs).values({
  projectId: project.id,
  code: "DV-0002",
  serviceType: "camera",
  title: "Cấu hình đầu ghi",
  checklist: createDefaultChecklist("camera"),
}).returning();

if (job.status !== "new" || job.checklist.length !== 6) {
  throw new Error("service job defaults or checklist were not persisted");
}

const [tradeRecord] = await db.insert(serviceJobTradeRecords).values({
  jobId: job.id,
  serviceType: "camera",
  data: { serviceType: "camera", safety: [], measurements: [] },
}).returning();
if (tradeRecord.version !== 1 || tradeRecord.serviceType !== "camera") {
  throw new Error("service trade record was not persisted");
}

const [dependency] = await db.insert(serviceJobDependencies).values({
  projectId: project.id,
  predecessorJobId: job.id,
  successorJobId: secondJob.id,
  dependencyType: "finish_to_start",
}).returning();
if (dependency.status !== "pending") {
  throw new Error("service job dependency was not persisted");
}

const [coordination] = await db.insert(serviceCoordinationPoints).values({
  projectId: project.id,
  title: "Tủ kỹ thuật",
  serviceTypes: ["camera", "electrical"],
}).returning();
if (coordination.serviceTypes.length !== 2) {
  throw new Error("service coordination point was not persisted");
}

const [asset] = await db.insert(installedAssets).values({
  projectId: project.id,
  jobId: job.id,
  assetKind: "nvr",
  name: "NVR Hikvision",
  specs: { channels: 8 },
}).returning();
const [vault] = await db.insert(serviceCameraVaults).values({
  projectId: project.id,
  assetId: asset.id,
  ciphertext: "ciphertext",
  iv: "AAAAAAAAAAAAAAAA",
  authTag: "AAAAAAAAAAAAAAAAAAAAAA==",
  configured: true,
}).returning();
if (!vault.configured || asset.specs.channels !== 8) {
  throw new Error("camera vault summary or asset specs were not persisted");
}

const [cost] = await db.insert(serviceCostEntries).values({
  projectId: project.id,
  jobId: job.id,
  type: "labor",
  description: "Thi công kéo dây",
  quantity: "8",
  unitCost: "150000",
  amount: "1200000",
}).returning();
if (cost.type !== "labor" || Number(cost.amount) !== 1200000) {
  throw new Error("service cost entry was not persisted");
}

const [document] = await db.insert(serviceHandoverDocuments).values({
  projectId: project.id,
  jobId: job.id,
  type: "acceptance",
  title: "Nghiệm thu camera",
  content: "Đã kiểm tra hình ảnh và ghi hình.",
  photoUrls: ["https://example.com/acceptance.jpg"],
  status: "signed",
  signedBy: "Chị Hà",
  signedAt: "2026-07-22",
}).returning();
if (document.status !== "signed" || document.photoUrls.length !== 1) {
  throw new Error("service handover document was not persisted");
}

const [plan] = await db.insert(serviceMaintenancePlans).values({
  projectId: project.id,
  assetId: null,
  serviceType: "camera",
  title: "Vệ sinh đầu ghi",
  intervalDays: 90,
  nextDueOn: "2026-10-20",
}).returning();
if (plan.intervalDays !== 90 || plan.isActive !== true) {
  throw new Error("service maintenance plan was not persisted");
}

console.log("service schema: project trades, coordination, camera vault, cost, handover, and maintenance persisted");

await client.close();

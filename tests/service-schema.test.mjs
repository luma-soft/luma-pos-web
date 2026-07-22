import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const { projects, serviceJobs, serviceCostEntries, serviceHandoverDocuments } = schema;
const { createDefaultChecklist } = await import(
  `${projectRoot}/src/lib/services/domain.ts`
);

const client = new PGlite();
const db = drizzle(client, { schema });

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

if (job.status !== "new" || job.checklist.length !== 6) {
  throw new Error("service job defaults or checklist were not persisted");
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

console.log("service schema: project, camera job, cost, and handover persisted");

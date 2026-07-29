import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  profiles,
  projects,
  serviceJobs,
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
} = schema;
const { generateMaintenanceOccurrenceCore } = await import(
  `${projectRoot}/src/lib/services/maintenance-worker.ts`
);

const client = new PGlite();
const db = drizzle(client, { schema });
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
  serviceStage: "completed",
}).returning();
const [plan] = await db.insert(serviceMaintenancePlans).values({
  projectId: project.id,
  title: "Bảo trì camera định kỳ",
  intervalDays: 90,
  nextDueOn: "2026-08-01",
  assignedTo: technicianId,
}).returning();

const first = await db.transaction((tx) => generateMaintenanceOccurrenceCore(
  tx,
  plan.id,
  new Date("2026-07-29T01:00:00.000Z"),
));
const replay = await db.transaction((tx) => generateMaintenanceOccurrenceCore(
  tx,
  plan.id,
  new Date("2026-07-29T02:00:00.000Z"),
));
if (!first.created || replay.created) throw new Error("maintenance occurrence was not idempotent");
if (first.jobId !== replay.jobId) throw new Error("maintenance replay returned a different job");

const occurrences = await db.select().from(serviceMaintenanceOccurrences)
  .where(eq(serviceMaintenanceOccurrences.planId, plan.id));
const jobs = await db.select().from(serviceJobs).where(eq(serviceJobs.projectId, project.id));
if (occurrences.length !== 1 || jobs.length !== 1) throw new Error("maintenance retry created duplicates");
if (jobs[0].assignedTo !== technicianId || jobs[0].status !== "scheduled") {
  throw new Error("maintenance job assignment/status is incorrect");
}

console.log("maintenance worker: due plan creates one assigned job and replay is idempotent");

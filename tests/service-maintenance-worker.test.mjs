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
  serviceJobAssignments,
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
} = schema;
const maintenanceModule = await import(
  `${projectRoot}/src/lib/services/maintenance-worker.ts`
);
const { generateMaintenanceOccurrenceCore } = maintenanceModule;
const completeMaintenanceOccurrenceForJobCore =
  maintenanceModule.completeMaintenanceOccurrenceForJobCore
  ?? (async () => undefined);
const markOverdueMaintenanceOccurrencesCore =
  maintenanceModule.markOverdueMaintenanceOccurrencesCore
  ?? (async () => []);

const client = new PGlite();
const db = drizzle(client, { schema });
for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}

const technicianId = "11111111-1111-4111-8111-111111111111";
const secondaryTechnicianId = "22222222-2222-4222-8222-222222222222";
const managerId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";
await db.insert(profiles).values({
  id: technicianId,
  fullName: "Kỹ thuật viên An",
  role: "technician",
});
await db.insert(profiles).values([
  {
    id: secondaryTechnicianId,
    fullName: "Kỹ thuật viên Bình",
    role: "technician",
  },
  { id: managerId, fullName: "Quản lý", role: "manager" },
  { id: ownerId, fullName: "Chủ cửa hàng", role: "owner" },
  {
    id: "55555555-5555-4555-8555-555555555555",
    fullName: "Quản lý nghỉ việc",
    role: "manager",
    isActive: false,
  },
]);
const [project] = await db.insert(projects).values({
  name: "Camera kho",
  serviceType: "camera",
  serviceStage: "completed",
}).returning();
const [plan] = await db.insert(serviceMaintenancePlans).values({
  projectId: project.id,
  serviceType: "camera",
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

await db.transaction((tx) => completeMaintenanceOccurrenceForJobCore(
  tx,
  first.jobId,
  new Date("2026-08-03T09:00:00.000Z"),
));
let [completedOccurrence] = await db.select().from(serviceMaintenanceOccurrences)
  .where(eq(serviceMaintenanceOccurrences.jobId, first.jobId));
let [advancedPlan] = await db.select().from(serviceMaintenancePlans)
  .where(eq(serviceMaintenancePlans.id, plan.id));
if (
  completedOccurrence.status !== "completed"
  || completedOccurrence.completedAt?.toISOString() !== "2026-08-03T09:00:00.000Z"
  || advancedPlan.lastCompletedOn !== "2026-08-03"
  || advancedPlan.nextDueOn !== "2026-10-30"
) {
  throw new Error("completed maintenance job did not advance its linked occurrence and plan");
}

await db.transaction((tx) => completeMaintenanceOccurrenceForJobCore(
  tx,
  first.jobId,
  new Date("2026-08-04T09:00:00.000Z"),
));
[advancedPlan] = await db.select().from(serviceMaintenancePlans)
  .where(eq(serviceMaintenancePlans.id, plan.id));
if (
  advancedPlan.lastCompletedOn !== "2026-08-03"
  || advancedPlan.nextDueOn !== "2026-10-30"
) {
  throw new Error("completion retry advanced the maintenance plan twice");
}

const secondCycle = await db.transaction((tx) => generateMaintenanceOccurrenceCore(
  tx,
  plan.id,
  new Date("2026-10-20T01:00:00.000Z"),
));
await db.transaction((tx) => completeMaintenanceOccurrenceForJobCore(
  tx,
  secondCycle.jobId,
  new Date("2026-11-02T09:00:00.000Z"),
));
[advancedPlan] = await db.select().from(serviceMaintenancePlans)
  .where(eq(serviceMaintenancePlans.id, plan.id));
if (
  advancedPlan.lastCompletedOn !== "2026-11-02"
  || advancedPlan.nextDueOn !== "2027-01-28"
) {
  throw new Error("consecutive maintenance cycle drifted or failed to advance");
}

const [mixedProject] = await db.insert(projects).values({
  name: "Công trình hỗn hợp",
  serviceType: "mixed",
  serviceStage: "completed",
}).returning();
const [mixedPlan] = await db.insert(serviceMaintenancePlans).values({
  projectId: mixedProject.id,
  serviceType: "electrical",
  title: "Bảo trì điện định kỳ",
  intervalDays: 30,
  nextDueOn: "2026-08-01",
  assignedTo: technicianId,
}).returning();
const mixedResult = await db.transaction((tx) => generateMaintenanceOccurrenceCore(
  tx,
  mixedPlan.id,
  new Date("2026-07-29T03:00:00.000Z"),
));
const [mixedJob] = await db.select().from(serviceJobs)
  .where(eq(serviceJobs.id, mixedResult.jobId));
if (mixedJob?.serviceType !== "electrical") {
  throw new Error("mixed project plan did not retain its explicit concrete service type");
}

await db.insert(serviceJobAssignments).values({
  jobId: mixedJob.id,
  profileId: secondaryTechnicianId,
  assignmentRole: "crew",
  assignedAt: new Date("2026-07-29T03:05:00.000Z"),
});
const firstOverdue = await db.transaction((tx) =>
  markOverdueMaintenanceOccurrencesCore(
    tx,
    new Date("2026-08-02T02:00:00.000Z"),
  )
);
const replayOverdue = await db.transaction((tx) =>
  markOverdueMaintenanceOccurrencesCore(
    tx,
    new Date("2026-08-02T03:00:00.000Z"),
  )
);
const [overdueOccurrence] = await db.select().from(serviceMaintenanceOccurrences)
  .where(eq(serviceMaintenanceOccurrences.jobId, mixedJob.id));
const expectedTargets = [
  technicianId,
  secondaryTechnicianId,
  managerId,
  ownerId,
].sort();
if (
  overdueOccurrence.status !== "overdue"
  || firstOverdue.length !== 1
  || replayOverdue.length !== 1
  || firstOverdue[0].notificationKey !== `service-maintenance-overdue:${overdueOccurrence.id}`
  || replayOverdue[0].notificationKey !== firstOverdue[0].notificationKey
  || JSON.stringify([...firstOverdue[0].userIds].sort()) !== JSON.stringify(expectedTargets)
  || JSON.stringify([...replayOverdue[0].userIds].sort()) !== JSON.stringify(expectedTargets)
) {
  throw new Error("overdue transition/escalation was not replay-safe or targeted exactly");
}

let rollbackObserved = false;
try {
  await db.transaction(async (tx) => {
    await completeMaintenanceOccurrenceForJobCore(
      tx,
      mixedJob.id,
      new Date("2026-08-03T09:00:00.000Z"),
    );
    throw new Error("ROLLBACK_MAINTENANCE_COMPLETION");
  });
} catch (error) {
  rollbackObserved =
    error instanceof Error
    && error.message === "ROLLBACK_MAINTENANCE_COMPLETION";
}
const [rolledBackOccurrence] = await db.select().from(serviceMaintenanceOccurrences)
  .where(eq(serviceMaintenanceOccurrences.jobId, mixedJob.id));
const [rolledBackPlan] = await db.select().from(serviceMaintenancePlans)
  .where(eq(serviceMaintenancePlans.id, mixedPlan.id));
if (
  !rollbackObserved
  || rolledBackOccurrence.status !== "overdue"
  || rolledBackOccurrence.completedAt !== null
  || rolledBackPlan.lastCompletedOn !== null
  || rolledBackPlan.nextDueOn !== "2026-08-01"
) {
  throw new Error("maintenance completion did not roll back atomically");
}

console.log("maintenance worker: lifecycle, idempotency, overdue, and targets verified");

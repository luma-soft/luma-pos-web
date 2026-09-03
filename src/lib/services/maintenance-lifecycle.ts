import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
  serviceJobs,
  projects,
} from "@/db/schema";
import { recordActivity } from "@/lib/audit/activity-log";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function completeMaintenanceOccurrenceForJobCore(
  tx: ServiceTransaction,
  jobId: string,
  now = new Date(),
  actorId: string | null = null,
) {
  const [linked] = await tx.select({
    id: serviceMaintenanceOccurrences.id,
    planId: serviceMaintenanceOccurrences.planId,
  }).from(serviceMaintenanceOccurrences)
    .where(eq(serviceMaintenanceOccurrences.jobId, jobId))
    .limit(1);
  if (!linked) {
    return { completed: false };
  }
  const [plan] = await tx.select({
    storeId: serviceMaintenancePlans.storeId,
    projectId: serviceMaintenancePlans.projectId,
    title: serviceMaintenancePlans.title,
    intervalDays: serviceMaintenancePlans.intervalDays,
    lastCompletedOn: serviceMaintenancePlans.lastCompletedOn,
    nextDueOn: serviceMaintenancePlans.nextDueOn,
  }).from(serviceMaintenancePlans)
    .where(eq(serviceMaintenancePlans.id, linked.planId))
    .limit(1)
    .for("update");
  if (!plan) throw new Error("SERVICE_MAINTENANCE_PLAN_NOT_FOUND");
  const [occurrence] = await tx.select({
    id: serviceMaintenanceOccurrences.id,
    planId: serviceMaintenanceOccurrences.planId,
    dueOn: serviceMaintenanceOccurrences.dueOn,
    status: serviceMaintenanceOccurrences.status,
  }).from(serviceMaintenanceOccurrences)
    .where(eq(serviceMaintenanceOccurrences.id, linked.id))
    .limit(1)
    .for("update");
  if (!occurrence || occurrence.status === "completed") {
    return { completed: false };
  }
  if (occurrence.status !== "scheduled" && occurrence.status !== "overdue") {
    throw new Error("SERVICE_MAINTENANCE_OCCURRENCE_STATUS_INVALID");
  }

  const completedOn = now.toISOString().slice(0, 10);
  const cycleNextDueOn = addDays(occurrence.dueOn, plan.intervalDays);
  const lastCompletedOn = plan.lastCompletedOn && plan.lastCompletedOn > completedOn
    ? plan.lastCompletedOn
    : completedOn;
  const nextDueOn = plan.nextDueOn > cycleNextDueOn
    ? plan.nextDueOn
    : cycleNextDueOn;
  await tx.update(serviceMaintenanceOccurrences).set({
    status: "completed",
    completedAt: now,
  }).where(eq(serviceMaintenanceOccurrences.id, occurrence.id));
  await tx.update(serviceMaintenancePlans).set({
    lastCompletedOn,
    nextDueOn,
    updatedAt: now,
  }).where(eq(serviceMaintenancePlans.id, occurrence.planId));
  const [job] = await tx.select({ code: serviceJobs.code }).from(serviceJobs)
    .where(and(eq(serviceJobs.storeId, plan.storeId), eq(serviceJobs.id, jobId))).limit(1);
  const [project] = await tx.select({ name: projects.name }).from(projects)
    .where(and(eq(projects.storeId, plan.storeId), eq(projects.id, plan.projectId))).limit(1);
  await recordActivity(tx, {
    storeId: plan.storeId, actorId, ...(actorId ? {} : { source: "system" as const }),
    action: "service.maintenance.occurrence.completed", entityType: "service_maintenance_plan", entityId: occurrence.planId,
    before: { name: plan.title, code: job?.code, status: occurrence.status, dueOn: occurrence.dueOn, nextDueOn: plan.nextDueOn, lastCompletedOn: plan.lastCompletedOn },
    after: { name: plan.title, code: job?.code, status: "completed", dueOn: occurrence.dueOn, nextDueOn, lastCompletedOn },
    metadata: { projectId: plan.projectId, projectName: project?.name, jobId, planId: occurrence.planId, occurrenceId: occurrence.id },
  });
  return {
    completed: true,
    occurrenceId: occurrence.id,
    planId: occurrence.planId,
    nextDueOn,
  };
}

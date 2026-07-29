import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
} from "@/db/schema";

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
) {
  const [occurrence] = await tx.select({
    id: serviceMaintenanceOccurrences.id,
    planId: serviceMaintenanceOccurrences.planId,
    dueOn: serviceMaintenanceOccurrences.dueOn,
    status: serviceMaintenanceOccurrences.status,
  }).from(serviceMaintenanceOccurrences)
    .where(eq(serviceMaintenanceOccurrences.jobId, jobId))
    .limit(1)
    .for("update");
  if (!occurrence || occurrence.status === "completed") {
    return { completed: false };
  }
  if (occurrence.status !== "scheduled" && occurrence.status !== "overdue") {
    throw new Error("SERVICE_MAINTENANCE_OCCURRENCE_STATUS_INVALID");
  }

  const [plan] = await tx.select({
    intervalDays: serviceMaintenancePlans.intervalDays,
  }).from(serviceMaintenancePlans)
    .where(eq(serviceMaintenancePlans.id, occurrence.planId))
    .limit(1)
    .for("update");
  if (!plan) throw new Error("SERVICE_MAINTENANCE_PLAN_NOT_FOUND");

  const completedOn = now.toISOString().slice(0, 10);
  const nextDueOn = addDays(occurrence.dueOn, plan.intervalDays);
  await tx.update(serviceMaintenanceOccurrences).set({
    status: "completed",
    completedAt: now,
  }).where(eq(serviceMaintenanceOccurrences.id, occurrence.id));
  await tx.update(serviceMaintenancePlans).set({
    lastCompletedOn: completedOn,
    nextDueOn,
    updatedAt: now,
  }).where(eq(serviceMaintenancePlans.id, occurrence.planId));
  return {
    completed: true,
    occurrenceId: occurrence.id,
    planId: occurrence.planId,
    nextDueOn,
  };
}

import { and, eq, inArray, isNull, lt, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  profiles,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
} from "@/db/schema";
import { createDefaultChecklist } from "@/lib/services/domain";
import { requireActiveTechnicianCore } from "@/lib/services/job-assignment";
export { completeMaintenanceOccurrenceForJobCore } from "@/lib/services/maintenance-lifecycle";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

function maintenanceJobCode(planId: string, dueOn: string) {
  return `BT-${planId.slice(0, 8).toUpperCase()}-${dueOn.replaceAll("-", "")}`;
}

export async function markOverdueMaintenanceOccurrencesCore(
  tx: ServiceTransaction,
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10);
  const overdue = await tx.select({
    id: serviceMaintenanceOccurrences.id,
    jobId: serviceMaintenanceOccurrences.jobId,
    assignedTo: serviceJobs.assignedTo,
  }).from(serviceMaintenanceOccurrences)
    .leftJoin(serviceJobs, eq(serviceMaintenanceOccurrences.jobId, serviceJobs.id))
    .where(and(
      inArray(serviceMaintenanceOccurrences.status, ["scheduled", "overdue"]),
      lt(serviceMaintenanceOccurrences.dueOn, today),
    ))
    .for("update", { of: serviceMaintenanceOccurrences });

  const scheduledIds = overdue.map((item) => item.id);
  if (scheduledIds.length > 0) {
    await tx.update(serviceMaintenanceOccurrences).set({ status: "overdue" })
      .where(and(
        inArray(serviceMaintenanceOccurrences.id, scheduledIds),
        eq(serviceMaintenanceOccurrences.status, "scheduled"),
      ));
  }

  const managerRows = await tx.select({ id: profiles.id })
    .from(profiles)
    .where(and(
      eq(profiles.isActive, true),
      inArray(profiles.role, ["owner", "manager"]),
    ));
  const managerIds = managerRows.map((item) => item.id);
  const alerts = [];
  for (const occurrence of overdue) {
    if (!occurrence.jobId) continue;
    const crewRows = await tx.select({ id: profiles.id })
      .from(serviceJobAssignments)
      .innerJoin(profiles, eq(serviceJobAssignments.profileId, profiles.id))
      .where(and(
        eq(serviceJobAssignments.jobId, occurrence.jobId),
        eq(serviceJobAssignments.assignmentRole, "crew"),
        isNull(serviceJobAssignments.removedAt),
        eq(profiles.role, "technician"),
        eq(profiles.isActive, true),
      ));
    const canonicalAssignee = occurrence.assignedTo
      ? await tx.select({ id: profiles.id }).from(profiles).where(and(
          eq(profiles.id, occurrence.assignedTo),
          eq(profiles.role, "technician"),
          eq(profiles.isActive, true),
        )).limit(1)
      : [];
    alerts.push({
      occurrenceId: occurrence.id,
      jobId: occurrence.jobId,
      notificationKey: `service-maintenance-overdue:${occurrence.id}`,
      userIds: [...new Set([
        ...canonicalAssignee.map((item) => item.id),
        ...crewRows.map((item) => item.id),
        ...managerIds,
      ])],
    });
  }
  return alerts;
}

export async function generateMaintenanceOccurrenceCore(
  tx: ServiceTransaction,
  planId: string,
  now = new Date(),
) {
  const [plan] = await tx.select({
    id: serviceMaintenancePlans.id,
    projectId: serviceMaintenancePlans.projectId,
    title: serviceMaintenancePlans.title,
    nextDueOn: serviceMaintenancePlans.nextDueOn,
    assignedTo: serviceMaintenancePlans.assignedTo,
    isActive: serviceMaintenancePlans.isActive,
    serviceType: serviceMaintenancePlans.serviceType,
  }).from(serviceMaintenancePlans)
    .where(eq(serviceMaintenancePlans.id, planId))
    .limit(1)
    .for("update");
  if (!plan?.isActive) throw new Error("SERVICE_MAINTENANCE_PLAN_NOT_FOUND");
  if (plan.serviceType === "mixed") {
    throw new Error("SERVICE_MAINTENANCE_SERVICE_TYPE_REQUIRED");
  }
  await requireActiveTechnicianCore(tx, plan.assignedTo);
  const [outstanding] = await tx.select({
    jobId: serviceMaintenanceOccurrences.jobId,
    dueOn: serviceMaintenanceOccurrences.dueOn,
  }).from(serviceMaintenanceOccurrences)
    .where(and(
      eq(serviceMaintenanceOccurrences.planId, plan.id),
      inArray(serviceMaintenanceOccurrences.status, ["scheduled", "overdue"]),
    ))
    .limit(1);
  if (outstanding) {
    if (outstanding.dueOn !== plan.nextDueOn) {
      throw new Error("SERVICE_MAINTENANCE_OUTSTANDING");
    }
    return {
      created: false,
      jobId: outstanding.jobId,
      dueOn: outstanding.dueOn,
      assignedTo: plan.assignedTo,
    };
  }

  const [occurrence] = await tx.insert(serviceMaintenanceOccurrences).values({
    planId: plan.id,
    projectId: plan.projectId,
    dueOn: plan.nextDueOn,
    status: "scheduled",
    generatedAt: now,
  }).onConflictDoNothing({
    target: [
      serviceMaintenanceOccurrences.planId,
      serviceMaintenanceOccurrences.dueOn,
    ],
  }).returning({ id: serviceMaintenanceOccurrences.id });

  if (!occurrence) {
    const [existing] = await tx.select({ jobId: serviceMaintenanceOccurrences.jobId })
      .from(serviceMaintenanceOccurrences)
      .where(and(
        eq(serviceMaintenanceOccurrences.planId, plan.id),
        eq(serviceMaintenanceOccurrences.dueOn, plan.nextDueOn),
      ))
      .limit(1);
    return {
      created: false,
      jobId: existing?.jobId ?? null,
      dueOn: plan.nextDueOn,
      assignedTo: plan.assignedTo,
    };
  }

  const serviceType = plan.serviceType;
  const [job] = await tx.insert(serviceJobs).values({
    projectId: plan.projectId,
    code: maintenanceJobCode(plan.id, plan.nextDueOn),
    serviceType,
    title: plan.title,
    status: "scheduled",
    priority: "normal",
    assignedTo: plan.assignedTo,
    scheduledAt: new Date(`${plan.nextDueOn}T01:00:00.000Z`),
    description: "Công việc được tạo tự động từ kế hoạch bảo trì.",
    checklist: createDefaultChecklist(serviceType),
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: serviceJobs.id });
  await tx.update(serviceMaintenanceOccurrences).set({ jobId: job.id })
    .where(eq(serviceMaintenanceOccurrences.id, occurrence.id));
  if (plan.assignedTo) {
    await tx.insert(serviceJobAssignments).values({
      jobId: job.id,
      profileId: plan.assignedTo,
      assignmentRole: "primary",
      assignedBy: null,
      assignedAt: now,
    });
  }
  await tx.insert(serviceJobEvents).values({
    jobId: job.id,
    eventType: "maintenance.generated",
    actorId: null,
    payload: { planId: plan.id, occurrenceId: occurrence.id, dueOn: plan.nextDueOn },
    createdAt: now,
  });
  return {
    created: true,
    jobId: job.id,
    dueOn: plan.nextDueOn,
    assignedTo: plan.assignedTo,
  };
}

export async function runMaintenanceWorker(input?: {
  now?: Date;
  leadDays?: number;
}) {
  const { db } = await import("@/db");
  const now = input?.now ?? new Date();
  const leadDays = input?.leadDays ?? 14;
  const dueThrough = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const plans = await db.select({ id: serviceMaintenancePlans.id })
    .from(serviceMaintenancePlans)
    .where(and(
      eq(serviceMaintenancePlans.isActive, true),
      lte(serviceMaintenancePlans.nextDueOn, dueThrough),
    ));
  const results = [];
  for (const plan of plans) {
    results.push(await db.transaction((tx) =>
      generateMaintenanceOccurrenceCore(tx, plan.id, now)
    ));
  }
  const overdue = await db.transaction((tx) =>
    markOverdueMaintenanceOccurrencesCore(tx, now)
  );
  return {
    evaluated: plans.length,
    created: results.filter((result) => result.created).length,
    results,
    overdue,
  };
}

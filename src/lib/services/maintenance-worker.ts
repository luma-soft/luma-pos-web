import { and, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@/db";
import type * as schema from "@/db/schema";
import {
  projects,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
  serviceMaintenanceOccurrences,
  serviceMaintenancePlans,
} from "@/db/schema";
import { createDefaultChecklist } from "@/lib/services/domain";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

function maintenanceJobCode(planId: string, dueOn: string) {
  return `BT-${planId.slice(0, 8).toUpperCase()}-${dueOn.replaceAll("-", "")}`;
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
    serviceType: projects.serviceType,
  }).from(serviceMaintenancePlans)
    .innerJoin(projects, eq(serviceMaintenancePlans.projectId, projects.id))
    .where(eq(serviceMaintenancePlans.id, planId))
    .limit(1);
  if (!plan?.isActive || !plan.serviceType) throw new Error("SERVICE_MAINTENANCE_PLAN_NOT_FOUND");

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

  const serviceType = plan.serviceType === "mixed" ? "camera" : plan.serviceType;
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
  return {
    evaluated: plans.length,
    created: results.filter((result) => result.created).length,
    results,
  };
}

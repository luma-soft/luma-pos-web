import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  profiles,
  serviceJobAssignments,
  serviceJobs,
} from "@/db/schema";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

export async function requireActiveTechnicianCore(
  tx: ServiceTransaction,
  profileId: string | null | undefined,
) {
  if (!profileId) return null;
  const [profile] = await tx.select({
    id: profiles.id,
    role: profiles.role,
    isActive: profiles.isActive,
  }).from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  if (!profile?.isActive || profile.role !== "technician") {
    throw new Error("SERVICE_MAINTENANCE_ASSIGNEE_INVALID");
  }
  return profile.id;
}

export async function syncServiceJobPrimaryAssigneeCore(
  tx: ServiceTransaction,
  jobId: string,
  profileId: string | null | undefined,
  actorId: string | null,
  now = new Date(),
) {
  const [job] = await tx.select({ id: serviceJobs.id })
    .from(serviceJobs)
    .where(eq(serviceJobs.id, jobId))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  const assigneeId = await requireActiveTechnicianCore(tx, profileId);
  await tx.update(serviceJobAssignments).set({ removedAt: now })
    .where(and(
      eq(serviceJobAssignments.jobId, jobId),
      eq(serviceJobAssignments.assignmentRole, "primary"),
      isNull(serviceJobAssignments.removedAt),
    ));
  await tx.update(serviceJobs).set({
    assignedTo: assigneeId,
    updatedAt: now,
  }).where(eq(serviceJobs.id, jobId));
  if (assigneeId) {
    await tx.insert(serviceJobAssignments).values({
      jobId,
      profileId: assigneeId,
      assignmentRole: "primary",
      assignedBy: actorId,
      assignedAt: now,
    }).onConflictDoUpdate({
      target: [
        serviceJobAssignments.jobId,
        serviceJobAssignments.profileId,
      ],
      set: {
        assignmentRole: "primary",
        assignedBy: actorId,
        assignedAt: now,
        removedAt: null,
      },
    });
  }
  return assigneeId;
}

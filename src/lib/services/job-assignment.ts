import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  profiles,
  auditLogs,
  serviceJobAssignments,
  serviceJobEvents,
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
  updateJob = true,
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
  if (updateJob) {
    await tx.update(serviceJobs).set({
      assignedTo: assigneeId,
      updatedAt: now,
    }).where(eq(serviceJobs.id, jobId));
  }
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

export async function assignServiceJobCore(
  tx: ServiceTransaction,
  input: {
    jobId: string;
    profileId: string;
    assignmentRole: "primary" | "crew";
    actorId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [job] = await tx.select({
    id: serviceJobs.id,
    assignedTo: serviceJobs.assignedTo,
  }).from(serviceJobs)
    .where(eq(serviceJobs.id, input.jobId))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  await requireActiveTechnicianCore(tx, input.profileId);
  if (input.assignmentRole === "crew" && job.assignedTo === input.profileId) {
    throw new Error("SERVICE_ASSIGNMENT_PRIMARY_CONFLICT");
  }

  if (input.assignmentRole === "primary") {
    await syncServiceJobPrimaryAssigneeCore(
      tx,
      input.jobId,
      input.profileId,
      input.actorId,
      now,
    );
  } else {
    await tx.insert(serviceJobAssignments).values({
      jobId: input.jobId,
      profileId: input.profileId,
      assignmentRole: "crew",
      assignedBy: input.actorId,
      assignedAt: now,
    }).onConflictDoUpdate({
      target: [serviceJobAssignments.jobId, serviceJobAssignments.profileId],
      set: {
        assignmentRole: "crew",
        assignedBy: input.actorId,
        assignedAt: now,
        removedAt: null,
      },
    });
  }
  await tx.insert(serviceJobEvents).values({
    jobId: input.jobId,
    eventType: "job.assigned",
    actorId: input.actorId,
    payload: {
      profileId: input.profileId,
      assignmentRole: input.assignmentRole,
    },
  });
  await tx.insert(auditLogs).values({
    actorId: input.actorId,
    source: "manual",
    action: "service_job.assignment.upsert",
    entityType: "service_job",
    entityId: input.jobId,
    after: {
      profileId: input.profileId,
      assignmentRole: input.assignmentRole,
    },
    affectedRecords: [{
      entityType: "service_job_assignment",
      entityId: input.profileId,
    }],
  });
  const [assignment] = await tx.select().from(serviceJobAssignments)
    .where(and(
      eq(serviceJobAssignments.jobId, input.jobId),
      eq(serviceJobAssignments.profileId, input.profileId),
      isNull(serviceJobAssignments.removedAt),
    ))
    .limit(1);
  if (!assignment) throw new Error("SERVICE_ASSIGNMENT_NOT_FOUND");
  return assignment;
}

export async function unassignServiceJobCore(
  tx: ServiceTransaction,
  input: {
    jobId: string;
    profileId: string;
    actorId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [job] = await tx.select({
    id: serviceJobs.id,
    assignedTo: serviceJobs.assignedTo,
  }).from(serviceJobs)
    .where(eq(serviceJobs.id, input.jobId))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  const [assignment] = await tx.update(serviceJobAssignments)
    .set({ removedAt: now })
    .where(and(
      eq(serviceJobAssignments.jobId, input.jobId),
      eq(serviceJobAssignments.profileId, input.profileId),
      isNull(serviceJobAssignments.removedAt),
    ))
    .returning({ assignmentRole: serviceJobAssignments.assignmentRole });
  if (!assignment) throw new Error("SERVICE_ASSIGNMENT_NOT_FOUND");
  if (assignment.assignmentRole === "primary") {
    await tx.update(serviceJobs).set({ assignedTo: null, updatedAt: now })
      .where(and(
        eq(serviceJobs.id, input.jobId),
        eq(serviceJobs.assignedTo, input.profileId),
      ));
  }
  await tx.insert(serviceJobEvents).values({
    jobId: input.jobId,
    eventType: "job.unassigned",
    actorId: input.actorId,
    payload: {
      profileId: input.profileId,
      assignmentRole: assignment.assignmentRole,
    },
  });
  await tx.insert(auditLogs).values({
    actorId: input.actorId,
    source: "manual",
    action: "service_job.assignment.remove",
    entityType: "service_job",
    entityId: input.jobId,
    before: {
      profileId: input.profileId,
      assignmentRole: assignment.assignmentRole,
    },
    affectedRecords: [{
      entityType: "service_job_assignment",
      entityId: input.profileId,
    }],
  });
  return assignment;
}

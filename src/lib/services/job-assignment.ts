import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  profiles,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
} from "@/db/schema";
import { recordActivity } from "@/lib/audit/activity-log";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

export async function requireActiveTechnicianCore(
  tx: ServiceTransaction,
  storeId: string,
  profileId: string | null | undefined,
) {
  if (!profileId) return null;
  const [profile] = await tx.select({
    id: profiles.id,
    role: profiles.role,
    isActive: profiles.isActive,
  }).from(profiles)
    .where(and(eq(profiles.storeId, storeId), eq(profiles.id, profileId)))
    .limit(1);
  if (!profile?.isActive || profile.role !== "technician") {
    throw new Error("SERVICE_MAINTENANCE_ASSIGNEE_INVALID");
  }
  return profile.id;
}

export async function syncServiceJobPrimaryAssigneeCore(
  tx: ServiceTransaction,
  storeId: string,
  jobId: string,
  profileId: string | null | undefined,
  actorId: string | null,
  now = new Date(),
  updateJob = true,
) {
  const [job] = await tx.select({ id: serviceJobs.id })
    .from(serviceJobs)
    .where(and(eq(serviceJobs.storeId, storeId), eq(serviceJobs.id, jobId)))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  const assigneeId = await requireActiveTechnicianCore(tx, storeId, profileId);
  await tx.update(serviceJobAssignments).set({ removedAt: now })
    .where(and(
      eq(serviceJobAssignments.jobId, jobId),
      eq(serviceJobAssignments.storeId, storeId),
      eq(serviceJobAssignments.assignmentRole, "primary"),
      isNull(serviceJobAssignments.removedAt),
    ));
  if (updateJob) {
    await tx.update(serviceJobs).set({
      assignedTo: assigneeId,
      updatedAt: now,
    }).where(and(eq(serviceJobs.storeId, storeId), eq(serviceJobs.id, jobId)));
  }
  if (assigneeId) {
    await tx.insert(serviceJobAssignments).values({
      storeId,
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
    storeId: string;
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
    code: serviceJobs.code,
    title: serviceJobs.title,
    projectId: serviceJobs.projectId,
    assignedTo: serviceJobs.assignedTo,
  }).from(serviceJobs)
    .where(and(eq(serviceJobs.storeId, input.storeId), eq(serviceJobs.id, input.jobId)))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  await requireActiveTechnicianCore(tx, input.storeId, input.profileId);
  if (input.assignmentRole === "crew" && job.assignedTo === input.profileId) {
    throw new Error("SERVICE_ASSIGNMENT_PRIMARY_CONFLICT");
  }
  const [currentAssignment] = await tx.select().from(serviceJobAssignments)
    .where(and(
      eq(serviceJobAssignments.jobId, input.jobId),
      eq(serviceJobAssignments.storeId, input.storeId),
      eq(serviceJobAssignments.profileId, input.profileId),
      isNull(serviceJobAssignments.removedAt),
    )).limit(1);
  if (currentAssignment?.assignmentRole === input.assignmentRole
    && (input.assignmentRole !== "primary" || job.assignedTo === input.profileId)) {
    return currentAssignment;
  }
  const previousProfileId = input.assignmentRole === "primary"
    ? job.assignedTo ?? currentAssignment?.profileId ?? null
    : currentAssignment?.profileId ?? null;
  const assignees = await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles)
    .where(and(eq(profiles.storeId, input.storeId), inArray(profiles.id, [...new Set([input.profileId, ...(previousProfileId ? [previousProfileId] : [])])])));
  const assigneeNames = new Map(assignees.map((profile) => [profile.id, profile.name]));

  if (input.assignmentRole === "primary") {
    await syncServiceJobPrimaryAssigneeCore(
      tx,
      input.storeId,
      input.jobId,
      input.profileId,
      input.actorId,
      now,
    );
  } else {
    await tx.insert(serviceJobAssignments).values({
      storeId: input.storeId,
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
    storeId: input.storeId,
    jobId: input.jobId,
    eventType: "job.assigned",
    actorId: input.actorId,
    payload: {
      profileId: input.profileId,
      assignmentRole: input.assignmentRole,
    },
  });
  await recordActivity(tx, {
    storeId: input.storeId,
    actorId: input.actorId,
    action: "service_job.assignment.upsert",
    entityType: "service_job",
    entityId: input.jobId,
    before: {
      code: job.code,
      title: job.title,
      profileId: previousProfileId,
      assigneeName: previousProfileId ? assigneeNames.get(previousProfileId) ?? null : null,
      assignmentRole: input.assignmentRole === "primary" && job.assignedTo ? "primary" : currentAssignment?.assignmentRole ?? null,
    },
    after: {
      code: job.code,
      title: job.title,
      profileId: input.profileId,
      assigneeName: assigneeNames.get(input.profileId) ?? null,
      assignmentRole: input.assignmentRole,
    },
    affectedRecords: [
      { type: "service_job", id: job.id, code: job.code, name: job.title },
      ...assignees.map((profile) => ({ type: "profile", id: profile.id, name: profile.name })),
    ],
    metadata: { projectId: job.projectId },
  });
  const [assignment] = await tx.select().from(serviceJobAssignments)
    .where(and(
      eq(serviceJobAssignments.jobId, input.jobId),
      eq(serviceJobAssignments.storeId, input.storeId),
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
    storeId: string;
    jobId: string;
    profileId: string;
    actorId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [job] = await tx.select({
    id: serviceJobs.id,
    code: serviceJobs.code,
    title: serviceJobs.title,
    projectId: serviceJobs.projectId,
    assignedTo: serviceJobs.assignedTo,
  }).from(serviceJobs)
    .where(and(eq(serviceJobs.storeId, input.storeId), eq(serviceJobs.id, input.jobId)))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  const [assignment] = await tx.update(serviceJobAssignments)
    .set({ removedAt: now })
    .where(and(
      eq(serviceJobAssignments.jobId, input.jobId),
      eq(serviceJobAssignments.storeId, input.storeId),
      eq(serviceJobAssignments.profileId, input.profileId),
      isNull(serviceJobAssignments.removedAt),
    ))
    .returning({ assignmentRole: serviceJobAssignments.assignmentRole });
  if (!assignment) throw new Error("SERVICE_ASSIGNMENT_NOT_FOUND");
  if (assignment.assignmentRole === "primary") {
    await tx.update(serviceJobs).set({ assignedTo: null, updatedAt: now })
      .where(and(
        eq(serviceJobs.id, input.jobId),
        eq(serviceJobs.storeId, input.storeId),
        eq(serviceJobs.assignedTo, input.profileId),
      ));
  }
  await tx.insert(serviceJobEvents).values({
    storeId: input.storeId,
    jobId: input.jobId,
    eventType: "job.unassigned",
    actorId: input.actorId,
    payload: {
      profileId: input.profileId,
      assignmentRole: assignment.assignmentRole,
    },
  });
  const [assignee] = await tx.select({ name: profiles.fullName }).from(profiles)
    .where(and(eq(profiles.storeId, input.storeId), eq(profiles.id, input.profileId))).limit(1);
  await recordActivity(tx, {
    storeId: input.storeId,
    actorId: input.actorId,
    action: "service_job.assignment.remove",
    entityType: "service_job",
    entityId: input.jobId,
    before: {
      code: job.code,
      title: job.title,
      profileId: input.profileId,
      assigneeName: assignee?.name ?? null,
      assignmentRole: assignment.assignmentRole,
    },
    after: { code: job.code, title: job.title, profileId: null, assigneeName: null, assignmentRole: null },
    affectedRecords: [
      { type: "service_job", id: job.id, code: job.code, name: job.title },
      { type: "profile", id: input.profileId, name: assignee?.name },
    ],
    metadata: { projectId: job.projectId },
  });
  return assignment;
}

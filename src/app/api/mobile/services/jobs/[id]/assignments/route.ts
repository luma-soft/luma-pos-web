import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
} from "@/db/schema";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import { serviceJobAssignmentSchema } from "@/lib/services/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const body = await readJson(request);
  const { id } = await params;
  const parsed = serviceJobAssignmentSchema.safeParse({
    ...(body && typeof body === "object" ? body : {}),
    jobId: id,
  });
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const value = parsed.data;
  try {
    const result = await db.transaction(async (tx) => {
      const [job] = await tx.select({ id: serviceJobs.id })
        .from(serviceJobs)
        .where(eq(serviceJobs.id, id))
        .limit(1)
        .for("update");
      if (!job) return { outcome: "notFound" } as const;
      const [profile] = await tx.select({
        id: profiles.id,
        role: profiles.role,
        isActive: profiles.isActive,
      }).from(profiles).where(eq(profiles.id, value.profileId)).limit(1);
      if (
        !profile?.isActive
        || !["owner", "manager", "technician"].includes(profile.role)
      ) return { outcome: "invalidAssignee" } as const;
      const now = new Date();
      if (value.assignmentRole === "primary") {
        await tx.update(serviceJobAssignments).set({ removedAt: now })
          .where(and(
            eq(serviceJobAssignments.jobId, id),
            eq(serviceJobAssignments.assignmentRole, "primary"),
            ne(serviceJobAssignments.profileId, value.profileId),
          ));
        await tx.update(serviceJobs).set({
          assignedTo: value.profileId,
          updatedAt: now,
        }).where(eq(serviceJobs.id, id));
      }
      const [assignment] = await tx.insert(serviceJobAssignments).values({
        jobId: id,
        profileId: value.profileId,
        assignmentRole: value.assignmentRole,
        assignedBy: gate.userId,
        assignedAt: now,
      }).onConflictDoUpdate({
        target: [
          serviceJobAssignments.jobId,
          serviceJobAssignments.profileId,
        ],
        set: {
          assignmentRole: value.assignmentRole,
          assignedBy: gate.userId,
          assignedAt: now,
          removedAt: null,
        },
      }).returning();
      await tx.insert(serviceJobEvents).values({
        jobId: id,
        eventType: "job.assigned",
        actorId: gate.userId,
        payload: {
          profileId: value.profileId,
          assignmentRole: value.assignmentRole,
        },
      });
      return { outcome: "assigned", assignment } as const;
    });
    if (result.outcome === "notFound") return mobileError("errors.notFound", 404);
    if (result.outcome === "invalidAssignee") {
      return mobileError("services.errors.invalidAssignee", 409);
    }
    return mobileOk(result.assignment);
  } catch (error) {
    console.error("service assignment failed:", error);
    return mobileError("errors.serverError", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id } = await params;
  const profileId = new URL(request.url).searchParams.get("profileId");
  if (!profileId) return mobileError("errors.invalidData", 400);
  const now = new Date();
  try {
    const removed = await db.transaction(async (tx) => {
      const [assignment] = await tx.update(serviceJobAssignments).set({ removedAt: now })
        .where(and(
          eq(serviceJobAssignments.jobId, id),
          eq(serviceJobAssignments.profileId, profileId),
        ))
        .returning({ assignmentRole: serviceJobAssignments.assignmentRole });
      if (!assignment) return null;
      if (assignment.assignmentRole === "primary") {
        await tx.update(serviceJobs).set({ assignedTo: null, updatedAt: now })
          .where(and(eq(serviceJobs.id, id), eq(serviceJobs.assignedTo, profileId)));
      }
      await tx.insert(serviceJobEvents).values({
        jobId: id,
        eventType: "job.unassigned",
        actorId: gate.userId,
        payload: { profileId },
      });
      return assignment;
    });
    if (!removed) return mobileError("errors.notFound", 404);
    return mobileOk({ profileId });
  } catch (error) {
    console.error("service unassignment failed:", error);
    return mobileError("errors.serverError", 500);
  }
}

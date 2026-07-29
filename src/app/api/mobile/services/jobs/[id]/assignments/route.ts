import { db } from "@/db";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";
import {
  assignServiceJobCore,
  unassignServiceJobCore,
} from "@/lib/services/job-assignment";
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
    const assignment = await db.transaction((tx) => assignServiceJobCore(tx, {
      jobId: id,
      profileId: value.profileId,
      assignmentRole: value.assignmentRole,
      actorId: gate.userId,
    }));
    return mobileOk(assignment);
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_JOB_NOT_FOUND") {
      return mobileError("errors.notFound", 404);
    }
    if (error instanceof Error && error.message === "SERVICE_MAINTENANCE_ASSIGNEE_INVALID") {
      return mobileError("services.errors.invalidAssignee", 409);
    }
    if (error instanceof Error && error.message === "SERVICE_ASSIGNMENT_PRIMARY_CONFLICT") {
      return mobileError("services.errors.assignmentConflict", 409);
    }
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
  try {
    await db.transaction((tx) => unassignServiceJobCore(tx, {
      jobId: id,
      profileId,
      actorId: gate.userId,
    }));
    return mobileOk({ profileId });
  } catch (error) {
    if (
      error instanceof Error
      && ["SERVICE_JOB_NOT_FOUND", "SERVICE_ASSIGNMENT_NOT_FOUND"].includes(error.message)
    ) return mobileError("errors.notFound", 404);
    console.error("service unassignment failed:", error);
    return mobileError("errors.serverError", 500);
  }
}

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import {
  approvalModeFor,
  issueMobileApproval,
} from "@/lib/auth/mobile-approval";
import {
  mobilePermissionKeys,
  type MobilePermission,
} from "@/lib/auth/mobile-permissions";
import { verifyStaffPin } from "@/lib/auth/staff-pin-verifier";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate);

  const body = await readJson(request);
  const payload = body && typeof body === "object"
    ? body as Record<string, unknown>
    : null;
  const permissionValue = payload?.permission?.toString().trim() ?? "";
  const approverId = payload?.approverId?.toString().trim() ?? "";
  const pin = payload?.pin?.toString().trim() ?? "";
  const scope = payload?.scope?.toString().trim() ?? "";
  const reason = payload?.reason?.toString().trim() ?? "";
  if (
    !mobilePermissionKeys.includes(permissionValue as MobilePermission) ||
    !approverId ||
    !scope ||
    scope.length > 240 ||
    reason.length > 500
  ) {
    return mobileError("errors.invalidData");
  }
  const permission = permissionValue as MobilePermission;

  const verification = await verifyStaffPin(approverId, pin);
  if (!verification.ok) {
    await db.insert(auditLogs).values({
      actorId: gate.userId,
      source: "mobile",
      action: "auth.approval_failed",
      entityType: "profile",
      entityId: gate.userId,
      status: "unauthorized",
      metadata: {
        permission,
        scope,
        approverId,
        error: verification.error,
        failedAttempts: verification.failedAttempts,
      },
    });
    return mobileError(verification.error, verification.status);
  }

  const mode = approvalModeFor({
    requesterRole: gate.role,
    requesterId: gate.userId,
    approverRole: verification.staff.role,
    approverId: verification.staff.id,
    permission,
  });
  if (!mode) {
    await db.insert(auditLogs).values({
      actorId: gate.userId,
      source: "mobile",
      action: "auth.approval_denied",
      entityType: "profile",
      entityId: gate.userId,
      status: "unauthorized",
      metadata: { permission, scope, approverId },
    });
    return mobileError("errors.forbidden", 403);
  }

  const credential = await issueMobileApproval({
    requesterId: gate.userId,
    approverId: verification.staff.id,
    permission,
    scope,
    mode,
    reason,
  });
  await db.insert(auditLogs).values({
    actorId: verification.staff.id,
    actorNameSnapshot: verification.staff.fullName,
    source: "mobile",
    action: "auth.approval_issued",
    entityType: "profile",
    entityId: gate.userId,
    status: "confirmed",
    metadata: { permission, scope, mode, reason: reason || null },
  });
  return mobileOk({
    ...credential,
    permission,
    scope,
    mode,
    approvedBy: {
      id: verification.staff.id,
      fullName: verification.staff.fullName,
      role: verification.staff.role,
    },
  });
}

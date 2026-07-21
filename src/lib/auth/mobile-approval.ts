import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { mobileApprovals } from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import {
  permissionMatrixForRole,
  type MobilePermission,
} from "@/lib/auth/mobile-permissions";

export type MobileApprovalMode = "reauth" | "manager";

export function approvalModeFor(input: {
  requesterRole: Role;
  requesterId: string;
  approverRole: Role;
  approverId: string;
  permission: MobilePermission;
}): MobileApprovalMode | null {
  const grant = permissionMatrixForRole(input.requesterRole)[input.permission];
  if (grant.allowed && grant.reauthRequired) {
    return input.requesterId === input.approverId &&
      input.requesterRole === input.approverRole
      ? "reauth"
      : null;
  }
  if (
    !grant.allowed &&
    grant.managerApprovalAllowed &&
    input.requesterId !== input.approverId &&
    (input.approverRole === "owner" || input.approverRole === "manager")
  ) {
    return "manager";
  }
  return null;
}

export function createApprovalCredential(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashApprovalToken(token) };
}

export function hashApprovalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueMobileApproval(input: {
  requesterId: string;
  approverId: string;
  permission: MobilePermission;
  scope?: string | null;
  mode: MobileApprovalMode;
  reason?: string | null;
  ttlMs?: number;
}): Promise<{ token: string; expiresAt: number }> {
  const { db } = await import("@/db");
  const credential = createApprovalCredential();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? 2 * 60 * 1000));
  await db.insert(mobileApprovals).values({
    tokenHash: credential.tokenHash,
    requesterId: input.requesterId,
    approverId: input.approverId,
    permission: input.permission,
    scope: normalizeScope(input.scope),
    mode: input.mode,
    reason: normalizeReason(input.reason),
    expiresAt,
  });
  return { token: credential.token, expiresAt: expiresAt.getTime() };
}

export async function consumeMobileApproval(input: {
  request: Request;
  requesterId: string;
  permission: MobilePermission;
  scope?: string | null;
}): Promise<boolean> {
  const { db } = await import("@/db");
  const token = input.request.headers.get("x-luma-approval-token")?.trim();
  if (!token) return false;
  const scope = normalizeScope(input.scope);
  const [consumed] = await db
    .update(mobileApprovals)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(mobileApprovals.tokenHash, hashApprovalToken(token)),
      eq(mobileApprovals.requesterId, input.requesterId),
      eq(mobileApprovals.permission, input.permission),
      scope === null
        ? isNull(mobileApprovals.scope)
        : eq(mobileApprovals.scope, scope),
      isNull(mobileApprovals.consumedAt),
      gt(mobileApprovals.expiresAt, new Date()),
    ))
    .returning({ id: mobileApprovals.id });
  return Boolean(consumed);
}

export async function authorizeMobileSensitiveAction(input: {
  request: Request;
  requesterId: string;
  requesterRole: Role;
  permission: MobilePermission;
  scope: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const grant = permissionMatrixForRole(input.requesterRole)[input.permission];
  if (grant.allowed && !grant.reauthRequired) return { ok: true };
  if (!grant.reauthRequired && !grant.managerApprovalAllowed) {
    return { ok: false, error: "errors.forbidden" };
  }
  const approved = await consumeMobileApproval({
    request: input.request,
    requesterId: input.requesterId,
    permission: input.permission,
    scope: input.scope,
  });
  return approved
    ? { ok: true }
    : { ok: false, error: "errors.approvalRequired" };
}

function normalizeScope(scope?: string | null): string | null {
  const value = scope?.trim();
  if (!value) return null;
  return value.slice(0, 240);
}

function normalizeReason(reason?: string | null): string | null {
  const value = reason?.trim();
  if (!value) return null;
  return value.slice(0, 500);
}

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { profiles, staffInvitations } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { normalizePhone } from "@/lib/auth/phone";
import {
  canInviteStaffRole,
  invitationMatchesAccount,
} from "@/lib/auth/staff-invitation-policy";

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createStaffInvitation(input: {
  storeId: string;
  actorId: string;
  actorRole: Role;
  role: Role;
  email?: string | null;
  phone?: string | null;
  ttlMs?: number;
}) {
  if (!canInviteStaffRole(input.actorRole, input.role)) {
    return { ok: false as const, error: "errors.forbidden" };
  }
  const email = input.email?.trim().toLowerCase() || null;
  const phoneNormalized = input.phone ? normalizePhone(input.phone) : null;
  if (!email && !phoneNormalized) {
    return { ok: false as const, error: "errors.invalidData" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000));
  const [invitation] = await db.insert(staffInvitations).values({
    storeId: input.storeId,
    email,
    phoneNormalized,
    role: input.role,
    tokenHash: hashInvitationToken(token),
    invitedBy: input.actorId,
    expiresAt,
  }).returning({ id: staffInvitations.id });

  return {
    ok: true as const,
    data: { id: invitation.id, token, expiresAt: expiresAt.getTime() },
  };
}

export async function listStaffInvitations(storeId: string) {
  return db.select({
    id: staffInvitations.id,
    email: staffInvitations.email,
    phoneNormalized: staffInvitations.phoneNormalized,
    role: staffInvitations.role,
    expiresAt: staffInvitations.expiresAt,
    acceptedAt: staffInvitations.acceptedAt,
    revokedAt: staffInvitations.revokedAt,
    createdAt: staffInvitations.createdAt,
  }).from(staffInvitations)
    .where(eq(staffInvitations.storeId, storeId))
    .orderBy(staffInvitations.createdAt);
}

export async function revokeStaffInvitation(storeId: string, invitationId: string) {
  const [revoked] = await db.update(staffInvitations)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(staffInvitations.id, invitationId),
      eq(staffInvitations.storeId, storeId),
      isNull(staffInvitations.acceptedAt),
      isNull(staffInvitations.revokedAt),
    ))
    .returning({ id: staffInvitations.id });
  return revoked
    ? { ok: true as const, data: revoked }
    : { ok: false as const, error: "errors.notFound" };
}

export async function acceptStaffInvitation(input: {
  token: string;
  userId: string;
  email: string | null;
  phone: string | null;
  fullName: string;
}) {
  const tokenHash = hashInvitationToken(input.token.trim());
  if (!input.token.trim() || !input.fullName.trim()) {
    return { ok: false as const, error: "errors.invalidData" };
  }

  return db.transaction(async (tx) => {
    const [invitation] = await tx.select()
      .from(staffInvitations)
      .where(and(
        eq(staffInvitations.tokenHash, tokenHash),
        isNull(staffInvitations.acceptedAt),
        isNull(staffInvitations.revokedAt),
        gt(staffInvitations.expiresAt, new Date()),
      ))
      .limit(1)
      .for("update");
    if (!invitation) return { ok: false as const, error: "errors.notFound" };
    if (!invitationMatchesAccount(invitation, input)) {
      return { ok: false as const, error: "errors.forbidden" };
    }

    const [existing] = await tx.select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, input.userId))
      .limit(1);
    if (existing) return { ok: false as const, error: "errors.forbidden" };

    await tx.insert(profiles).values({
      id: input.userId,
      storeId: invitation.storeId,
      fullName: input.fullName.trim(),
      phone: input.phone,
      phoneNormalized: input.phone ? normalizePhone(input.phone) : null,
      role: invitation.role,
      isActive: true,
    });
    const [accepted] = await tx.update(staffInvitations)
      .set({ acceptedAt: new Date() })
      .where(and(
        eq(staffInvitations.id, invitation.id),
        isNull(staffInvitations.acceptedAt),
      ))
      .returning({ id: staffInvitations.id, storeId: staffInvitations.storeId });
    if (!accepted) throw new Error("INVITATION_ALREADY_CONSUMED");

    return {
      ok: true as const,
      data: { profileId: input.userId, storeId: accepted.storeId },
    };
  });
}

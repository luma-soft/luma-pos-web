import type { Role } from "@/lib/auth/roles";
import { normalizePhone } from "@/lib/auth/phone";

export function canInviteStaffRole(actorRole: Role, invitedRole: Role): boolean {
  if (actorRole === "owner") return true;
  return actorRole === "manager" && invitedRole !== "owner";
}

export function invitationMatchesAccount(
  invitation: { email: string | null; phoneNormalized: string | null },
  account: { email: string | null; phone: string | null },
): boolean {
  const invitedEmail = invitation.email?.trim().toLowerCase() ?? null;
  const accountEmail = account.email?.trim().toLowerCase() ?? null;
  if (invitedEmail && accountEmail && invitedEmail === accountEmail) return true;

  const accountPhone = account.phone ? normalizePhone(account.phone) : null;
  return Boolean(
    invitation.phoneNormalized &&
    accountPhone &&
    invitation.phoneNormalized === accountPhone,
  );
}

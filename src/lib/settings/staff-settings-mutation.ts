import { STAFF_ROLES, type StaffRole } from "@/lib/schemas/settings";
import type { Role } from "@/lib/actions/common";

export type StaffSettingsMutation =
  | {
      action: "role";
      id: string;
      role: StaffRole;
      scope: string;
    }
  | {
      action: "active";
      active: boolean;
      id: string;
      scope: string;
    };

export type StaffSettingsAuthority = {
  actorId: string;
  actorRole: Role;
  activeOwnerCount: number;
  targetActive: boolean;
  targetId: string;
  targetRole: StaffRole;
};

export function canResetStaffPin(input: {
  actorRole: Role;
  targetRole: StaffRole;
}): boolean {
  if (input.actorRole === "owner") return true;
  return input.actorRole === "manager" && input.targetRole !== "owner";
}

export function canApplyStaffSettingsMutation(
  authority: StaffSettingsAuthority,
  mutation: StaffSettingsMutation,
): boolean {
  if (
    authority.actorId === authority.targetId &&
    (mutation.action === "role" || !mutation.active)
  ) {
    return false;
  }
  if (
    authority.actorRole === "manager" &&
    (authority.targetRole === "owner" ||
      (mutation.action === "role" && mutation.role === "owner"))
  ) {
    return false;
  }
  if (
    authority.targetRole === "owner" &&
    authority.targetActive &&
    authority.activeOwnerCount <= 1 &&
    ((mutation.action === "role" && mutation.role !== "owner") ||
      (mutation.action === "active" && !mutation.active))
  ) {
    return false;
  }
  return true;
}

export function parseStaffSettingsMutation(
  input: unknown,
): StaffSettingsMutation | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as { active?: unknown; id?: unknown; role?: unknown };
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return null;
  const hasActive = Object.hasOwn(payload, "active");
  const hasRole = Object.hasOwn(payload, "role");
  if (hasActive === hasRole) return null;
  if (typeof payload.active === "boolean") {
    return {
      action: "active",
      active: payload.active,
      id,
      scope: `settings:staff:${id}:active`,
    };
  }
  if (typeof payload.role !== "string") return null;
  if (!STAFF_ROLES.includes(payload.role as StaffRole)) return null;
  return {
    action: "role",
    id,
    role: payload.role as StaffRole,
    scope: `settings:staff:${id}:role`,
  };
}

import type { Role } from "@/lib/actions/common";

type ServiceJobAccessInput = {
  role: Role;
  profileId: string;
  primaryAssigneeId: string | null;
  crewProfileIds: readonly string[];
};

export function canAccessServiceJob(input: ServiceJobAccessInput): boolean {
  if (input.role === "owner" || input.role === "manager") return true;
  if (input.role !== "technician") return false;
  return input.primaryAssigneeId === input.profileId
    || input.crewProfileIds.includes(input.profileId);
}

export function canManageServiceDispatch(role: Role): boolean {
  return role === "owner" || role === "manager";
}

export function fieldJobDateRange(
  scope: "today" | "week",
  now = new Date(),
  utcOffsetMinutes = 420,
) {
  const offsetMs = utcOffsetMinutes * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  const localDayStartAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const from = new Date(localDayStartAsUtc - offsetMs);
  const days = scope === "week" ? 7 : 1;
  return {
    from,
    to: new Date(from.getTime() + days * 24 * 60 * 60 * 1000),
  };
}

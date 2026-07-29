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

import { STAFF_ROLES, type Role } from "@/lib/auth/roles";

export type StoreStatus = "active" | "suspended" | "archived";

export type StorePrincipal = {
  userId: string;
  storeId: string;
  role: Role;
};

export function activeStorePrincipal(input: {
  userId: string;
  storeId: string | null;
  role: string;
  profileActive: boolean;
  storeStatus: StoreStatus;
}): StorePrincipal | null {
  if (
    !input.profileActive ||
    input.storeStatus !== "active" ||
    !input.storeId ||
    !STAFF_ROLES.includes(input.role as Role)
  ) {
    return null;
  }
  return {
    userId: input.userId,
    storeId: input.storeId,
    role: input.role as Role,
  };
}

export function sameStore(
  left: { storeId: string },
  right: { storeId: string },
): boolean {
  return left.storeId === right.storeId;
}

import type { Role } from "@/lib/actions/common";

export const mobilePermissionKeys = [
  "dashboard.view",
  "service.field",
  "service.credentials",
  "pos.sell",
  "catalog.manage",
  "reports.view",
  "price.override",
  "discount.override_limit",
  "refund.create",
  "order.void",
  "stock.adjust",
  "cash.manage",
  "payment.reconcile",
  "customer.erase",
  "settings.sensitive",
] as const;

export type MobilePermission = (typeof mobilePermissionKeys)[number];

export type MobilePermissionGrant = {
  allowed: boolean;
  reauthRequired: boolean;
  managerApprovalAllowed: boolean;
};

export type MobilePermissionMatrix = Record<
  MobilePermission,
  MobilePermissionGrant
>;

// Temporary product policy: keep the sensitive-action PIN workflow dormant.
// This does not promote restricted roles; it only removes re-authentication
// from permissions a role already owns directly.
export const mobileSensitiveApprovalEnabled = false;

const denied = (): MobilePermissionGrant => ({
  allowed: false,
  reauthRequired: false,
  managerApprovalAllowed: false,
});

const direct = (reauthRequired = false): MobilePermissionGrant => ({
  allowed: true,
  reauthRequired,
  managerApprovalAllowed: false,
});

const sensitiveDirect = (): MobilePermissionGrant =>
  direct(mobileSensitiveApprovalEnabled);

const approval = (): MobilePermissionGrant =>
  mobileSensitiveApprovalEnabled
    ? {
        allowed: false,
        reauthRequired: false,
        managerApprovalAllowed: true,
      }
    : denied();

function emptyMatrix(): MobilePermissionMatrix {
  return Object.fromEntries(
    mobilePermissionKeys.map((permission) => [permission, denied()])
  ) as MobilePermissionMatrix;
}

export function permissionMatrixForRole(role: Role): MobilePermissionMatrix {
  const matrix = emptyMatrix();
  matrix["dashboard.view"] = direct();

  if (role === "owner") {
    for (const permission of mobilePermissionKeys) {
      matrix[permission] = direct();
    }
    return matrix;
  }

  if (role === "manager") {
    matrix["service.field"] = direct();
    matrix["service.credentials"] = sensitiveDirect();
    matrix["reports.view"] = direct();
    matrix["pos.sell"] = direct();
    matrix["catalog.manage"] = direct();
    matrix["price.override"] = sensitiveDirect();
    matrix["discount.override_limit"] = sensitiveDirect();
    matrix["refund.create"] = sensitiveDirect();
    matrix["order.void"] = sensitiveDirect();
    matrix["stock.adjust"] = sensitiveDirect();
    matrix["cash.manage"] = sensitiveDirect();
    matrix["payment.reconcile"] = sensitiveDirect();
    matrix["customer.erase"] = sensitiveDirect();
    matrix["settings.sensitive"] = sensitiveDirect();
    return matrix;
  }

  if (role === "cashier") {
    matrix["reports.view"] = direct();
    matrix["pos.sell"] = direct();
    matrix["price.override"] = approval();
    matrix["discount.override_limit"] = approval();
    matrix["refund.create"] = approval();
    matrix["order.void"] = approval();
    matrix["cash.manage"] = approval();
    return matrix;
  }

  if (role === "warehouse") {
    matrix["reports.view"] = direct();
    matrix["catalog.manage"] = direct();
    matrix["stock.adjust"] = approval();
    return matrix;
  }

  matrix["service.field"] = direct();
  return matrix;
}

import type { Role } from "@/lib/actions/common";

export const mobilePermissionKeys = [
  "dashboard.view",
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

const approval = (): MobilePermissionGrant => ({
  allowed: false,
  reauthRequired: false,
  managerApprovalAllowed: true,
});

function emptyMatrix(): MobilePermissionMatrix {
  return Object.fromEntries(
    mobilePermissionKeys.map((permission) => [permission, denied()])
  ) as MobilePermissionMatrix;
}

export function permissionMatrixForRole(role: Role): MobilePermissionMatrix {
  const matrix = emptyMatrix();
  matrix["dashboard.view"] = direct();
  matrix["reports.view"] = direct();

  if (role === "owner") {
    for (const permission of mobilePermissionKeys) {
      const sensitive = ![
        "dashboard.view",
        "pos.sell",
        "catalog.manage",
        "reports.view",
      ].includes(permission);
      matrix[permission] = direct(sensitive);
    }
    return matrix;
  }

  if (role === "manager") {
    matrix["pos.sell"] = direct();
    matrix["catalog.manage"] = direct();
    matrix["price.override"] = direct(true);
    matrix["discount.override_limit"] = direct(true);
    matrix["refund.create"] = direct(true);
    matrix["order.void"] = direct(true);
    matrix["stock.adjust"] = direct(true);
    matrix["cash.manage"] = direct(true);
    matrix["payment.reconcile"] = direct(true);
    matrix["customer.erase"] = direct(true);
    matrix["settings.sensitive"] = direct(true);
    return matrix;
  }

  if (role === "cashier") {
    matrix["pos.sell"] = direct();
    matrix["price.override"] = approval();
    matrix["discount.override_limit"] = approval();
    matrix["refund.create"] = approval();
    matrix["order.void"] = approval();
    matrix["cash.manage"] = approval();
    return matrix;
  }

  matrix["catalog.manage"] = direct();
  matrix["stock.adjust"] = approval();
  return matrix;
}

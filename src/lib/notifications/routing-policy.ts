import {
  MANAGER_ROLES,
  SALES_ACCESS_ROLES,
  STAFF_ROLES,
  STOCK_ACCESS_ROLES,
  type Role,
} from "@/lib/auth/roles";
import type {
  NotificationCategory,
  NotificationTarget,
} from "@/lib/notifications/contracts";

export type NotificationEntityType =
  | "order"
  | "purchase"
  | "customer"
  | "supplier"
  | "payment";

type NotificationRoutingRule = {
  target: NotificationTarget;
  entities: Partial<
    Record<NotificationEntityType, readonly Role[]>
  >;
};

export const notificationRoutingPolicy = {
  invoiceCreated: {
    target: "invoices",
    entities: { order: SALES_ACCESS_ROLES },
  },
  purchaseReceived: {
    target: "purchases",
    entities: { purchase: STOCK_ACCESS_ROLES },
  },
  debtChanged: {
    target: "debt",
    entities: {
      customer: SALES_ACCESS_ROLES,
      supplier: STOCK_ACCESS_ROLES,
    },
  },
  qrPaymentConfirmed: {
    target: "invoices",
    entities: { order: SALES_ACCESS_ROLES },
  },
  qrPaymentException: {
    target: "paymentReconciliation",
    entities: { payment: MANAGER_ROLES },
  },
} as const satisfies Record<NotificationCategory, NotificationRoutingRule>;

export const defaultInternalNotificationRoleRouting = {
  invoiceCreated: ["owner", "manager"],
  purchaseReceived: ["owner", "manager", "warehouse"],
  debtChanged: ["owner", "manager"],
  qrPaymentConfirmed: ["owner", "manager"],
  qrPaymentException: ["owner", "manager"],
} as const satisfies Record<NotificationCategory, readonly Role[]>;

export function configurableRolesForNotificationCategory(
  category: NotificationCategory,
): Role[] {
  const entityRoleSets = Object.values(
    notificationRoutingPolicy[category].entities,
  ) as Array<readonly Role[]>;
  return STAFF_ROLES.filter((role) =>
    entityRoleSets.some((roles) => roles.includes(role))
  );
}

export function normalizeConfiguredNotificationRoles(
  category: NotificationCategory,
  roles: unknown,
): Role[] {
  const allowed = configurableRolesForNotificationCategory(category);
  const normalized = Array.isArray(roles)
    ? STAFF_ROLES.filter((role) =>
      allowed.includes(role) && roles.some((candidate) => candidate === role)
    )
    : [];
  return normalized.length > 0
    ? normalized
    : [...defaultInternalNotificationRoleRouting[category]];
}

export function allowedRolesForNotificationTarget(input: {
  category: NotificationCategory;
  target: NotificationTarget;
  entityType: string;
}): readonly Role[] {
  const rule = notificationRoutingPolicy[input.category];
  if (rule.target !== input.target) return [];
  const entities = rule.entities as Partial<
    Record<NotificationEntityType, readonly Role[]>
  >;
  return entities[input.entityType as NotificationEntityType] ?? [];
}

export function roleCanOpenNotificationTarget(input: {
  category: NotificationCategory;
  target: NotificationTarget;
  entityType: string;
  role: Role;
}) {
  return allowedRolesForNotificationTarget(input).includes(input.role);
}

export function notificationRoutingPolicyContract() {
  return {
    version: 1 as const,
    roles: [...STAFF_ROLES],
    routes: Object.entries(notificationRoutingPolicy).flatMap(
      ([category, rule]) =>
        Object.entries(rule.entities).map(([entityType, allowedRoles]) => ({
          category: category as NotificationCategory,
          target: rule.target,
          entityType: entityType as NotificationEntityType,
          allowedRoles: [...allowedRoles],
        })),
    ),
  };
}

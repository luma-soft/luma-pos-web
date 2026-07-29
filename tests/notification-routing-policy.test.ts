import { describe, expect, test } from "bun:test";
import {
  configurableRolesForNotificationCategory,
  notificationRoutingPolicy,
  notificationRoutingPolicyContract,
  roleCanOpenNotificationTarget,
} from "../src/lib/notifications/routing-policy";
import {
  mobileNotificationSettingsPatchSchema,
  parseStorePrefs,
  storePrefsPatchSchema,
} from "../src/lib/schemas/settings";

const staffRoles = ["owner", "manager", "cashier", "warehouse"] as const;

describe("notification routing policy", () => {
  test("matches every configurable category, target, entity, and role to the exact API gate", () => {
    const expected = [
      {
        category: "invoiceCreated",
        target: "invoices",
        entityType: "order",
        allowedRoles: ["owner", "manager", "cashier"],
      },
      {
        category: "purchaseReceived",
        target: "purchases",
        entityType: "purchase",
        allowedRoles: ["owner", "manager", "warehouse"],
      },
      {
        category: "debtChanged",
        target: "debt",
        entityType: "customer",
        allowedRoles: ["owner", "manager", "cashier"],
      },
      {
        category: "debtChanged",
        target: "debt",
        entityType: "supplier",
        allowedRoles: ["owner", "manager", "warehouse"],
      },
      {
        category: "qrPaymentConfirmed",
        target: "invoices",
        entityType: "order",
        allowedRoles: ["owner", "manager", "cashier"],
      },
      {
        category: "qrPaymentException",
        target: "paymentReconciliation",
        entityType: "payment",
        allowedRoles: ["owner", "manager"],
      },
    ] as const;

    expect(notificationRoutingPolicyContract().routes).toEqual(expected);
    expect(notificationRoutingPolicy).toBeDefined();

    for (const route of expected) {
      for (const role of staffRoles) {
        expect(roleCanOpenNotificationTarget({
          category: route.category,
          target: route.target,
          entityType: route.entityType,
          role,
        })).toBe(route.allowedRoles.includes(role as never));
      }
      for (
        const wrongTarget of [
          "invoices",
          "purchases",
          "debt",
          "paymentReconciliation",
        ] as const
      ) {
        if (wrongTarget === route.target) continue;
        for (const role of staffRoles) {
          expect(roleCanOpenNotificationTarget({
            category: route.category,
            target: wrongTarget,
            entityType: route.entityType,
            role,
          })).toBe(false);
        }
      }
    }
  });

  test("normalizes legacy stored routes but rejects newly configured inaccessible roles", () => {
    expect(configurableRolesForNotificationCategory("debtChanged"))
      .toEqual(["owner", "manager", "cashier", "warehouse"]);

    const normalized = parseStorePrefs({
      notifications: {
        roleRouting: {
          invoiceCreated: ["warehouse", "cashier", "cashier"],
          purchaseReceived: ["cashier"],
          debtChanged: ["cashier", "warehouse"],
          qrPaymentConfirmed: ["warehouse", "manager"],
          qrPaymentException: ["cashier", "warehouse"],
        },
      },
    }).notifications.roleRouting;

    expect(normalized.invoiceCreated).toEqual(["cashier"]);
    expect(normalized.purchaseReceived).toEqual([
      "owner",
      "manager",
      "warehouse",
    ]);
    expect(normalized.debtChanged).toEqual(["cashier", "warehouse"]);
    expect(normalized.qrPaymentConfirmed).toEqual(["manager"]);
    expect(normalized.qrPaymentException).toEqual(["owner", "manager"]);

    for (
      const invalidPatch of [
        { invoiceCreated: ["warehouse"] },
        { purchaseReceived: ["cashier"] },
        { qrPaymentConfirmed: ["warehouse"] },
        { qrPaymentException: ["cashier"] },
      ]
    ) {
      expect(mobileNotificationSettingsPatchSchema.safeParse({
        roleRouting: invalidPatch,
      }).success).toBe(false);
      expect(storePrefsPatchSchema.safeParse({
        notifications: {
          ...parseStorePrefs({}).notifications,
          roleRouting: {
            ...parseStorePrefs({}).notifications.roleRouting,
            ...invalidPatch,
          },
        },
      }).success).toBe(false);
    }
  });
});

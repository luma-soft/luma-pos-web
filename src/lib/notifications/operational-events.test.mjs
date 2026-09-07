import { describe, expect, test } from "bun:test";
import { notificationCategories } from "@/lib/notifications/contracts";
import { shouldExcludeNotificationActor } from "@/lib/notifications/recipient-policy";
import { buildFcmMessage } from "@/lib/notifications/fcm-message";
import {
  allowedRolesForNotificationTarget,
  defaultInternalNotificationRoleRouting,
} from "@/lib/notifications/routing-policy";
import { parseStorePrefs } from "@/lib/schemas/settings";

const addedCategories = [
  "paymentReceived",
  "invoiceCancelled",
  "purchaseCancelled",
];

describe("operational push event contract", () => {
  test("keeps the actor as fallback when no other recipient exists", () => {
    const actorId = "00000000-0000-4000-8000-000000000001";
    expect(shouldExcludeNotificationActor({
      excludeActor: true,
      actorId,
      directRecipientIds: new Set(),
      recipientIds: [actorId],
    })).toBe(false);
    expect(shouldExcludeNotificationActor({
      excludeActor: true,
      actorId,
      directRecipientIds: new Set(),
      recipientIds: [actorId, "00000000-0000-4000-8000-000000000002"],
    })).toBe(true);
  });

  test("new operational categories are enabled and routed by default", () => {
    const prefs = parseStorePrefs(undefined);

    for (const category of addedCategories) {
      expect(notificationCategories).toContain(category);
      expect(prefs.notifications[category]).toBe(true);
      expect(prefs.notifications.roleRouting[category]).toEqual(
        [...defaultInternalNotificationRoleRouting[category]],
      );
    }
  });

  test("new categories only route to roles that can open their target", () => {
    expect(allowedRolesForNotificationTarget({
      category: "paymentReceived",
      target: "invoices",
      entityType: "order",
    })).toContain("cashier");
    expect(allowedRolesForNotificationTarget({
      category: "invoiceCancelled",
      target: "invoices",
      entityType: "order",
    })).not.toContain("warehouse");
    expect(allowedRolesForNotificationTarget({
      category: "purchaseCancelled",
      target: "purchases",
      entityType: "purchase",
    })).toContain("warehouse");
  });

  test("cancellation pushes use alert priority", () => {
    const message = buildFcmMessage({
      token: "device-token",
      eventId: "00000000-0000-4000-8000-000000000010",
      notificationKey: "event:00000000-0000-4000-8000-000000000010",
      category: "invoiceCancelled",
      target: "invoices",
      entityId: "00000000-0000-4000-8000-000000000011",
      now: new Date("2026-09-07T00:00:00.000Z"),
    });

    expect(message.message.android.priority).toBe("high");
    expect(message.message.apns.headers["apns-priority"]).toBe("10");
    expect(message.message.notification.title).toBe("Hóa đơn đã bị hủy");
  });
});

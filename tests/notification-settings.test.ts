import { describe, expect, test } from "bun:test";
import { notificationSettingsAuthorization } from "../src/lib/notifications/settings-authorization";
import { parseStorePrefs, storePrefsPatchSchema } from "../src/lib/schemas/settings";

describe("notification settings contract", () => {
  test("requires sensitive re-authentication for the complete settings mutation", () => {
    expect(notificationSettingsAuthorization).toEqual({
      permission: "settings.sensitive",
      scope: "settings:notifications",
    });
  });

  test("defaults only channels published by the delivery adapter registry", () => {
    expect(parseStorePrefs({}).notifications.channels).toEqual({
      inApp: true,
      push: true,
    });
  });

  test("upgrades legacy settings with server-owned delivery defaults", () => {
    const prefs = parseStorePrefs({
      notifications: {
        lowStock: true,
        stagnant: true,
        shiftClose: true,
        einvoiceError: true,
        syncDone: false,
        channels: { inApp: true, zalo: false, email: false, sms: false },
      },
    });
    expect(prefs.notifications.channels.push).toBe(true);
    expect(prefs.notifications.quietHours).toEqual({
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "Asia/Ho_Chi_Minh",
    });
    expect(prefs.notifications.thresholds.lowStockDays).toBe(7);
    expect(prefs.notifications.thresholds.einvoiceFailureAttempts).toBe(1);
    expect(prefs.notifications.roleRouting.lowStock)
      .toEqual(["owner", "manager", "warehouse"]);
  });

  test("rejects malformed quiet hours, thresholds, and empty role routes", () => {
    const base = parseStorePrefs({}).notifications;
    expect(storePrefsPatchSchema.safeParse({
      notifications: {
        ...base,
        quietHours: { ...base.quietHours, start: "25:00" },
      },
    }).success).toBe(false);
    expect(storePrefsPatchSchema.safeParse({
      notifications: {
        ...base,
        thresholds: { ...base.thresholds, lowStockDays: 0 },
      },
    }).success).toBe(false);
    expect(storePrefsPatchSchema.safeParse({
      notifications: {
        ...base,
        roleRouting: { ...base.roleRouting, lowStock: [] },
      },
    }).success).toBe(false);
  });
});

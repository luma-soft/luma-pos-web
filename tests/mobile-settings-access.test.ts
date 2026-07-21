import { describe, expect, test } from "bun:test";
import {
  canReadMobileSettingsAdministration,
  canReadMobileAiAdministration,
  mobileAiSettingsForRole,
  mobileNotificationSettingsForRole,
  mobileStoreSettingsForRole,
} from "../src/lib/settings/mobile-settings-access";
import { parseStorePrefs } from "../src/lib/schemas/settings";

describe("mobile settings read access", () => {
  test("cashier receives runtime store identity without sensitive settings", () => {
    const result = mobileStoreSettingsForRole({
      name: "Luma Store",
      address: "12 Private Street",
      phone: "0900000000",
      taxCode: "0312345678",
      industry: "restaurant",
      currency: "VND",
      locale: "vi-VN",
      onboarded: true,
      prefs: parseStorePrefs({
        security: { maxDiscountPercent: 15, sessionTimeoutMinutes: 5 },
        shopee: { partnerId: "partner-secret", defaultShopId: "shop-1" },
      }),
    }, "cashier");

    expect(result).toEqual({
      name: "Luma Store",
      industry: "restaurant",
      currency: "VND",
      locale: "vi-VN",
    });
    expect(JSON.stringify(result)).not.toContain("Private Street");
    expect(JSON.stringify(result)).not.toContain("0312345678");
    expect(JSON.stringify(result)).not.toContain("partner-secret");
    expect(JSON.stringify(result)).not.toContain("maxDiscountPercent");
  });

  test("only managers and owners can read administrative settings", () => {
    expect(canReadMobileSettingsAdministration("owner")).toBe(true);
    expect(canReadMobileSettingsAdministration("manager")).toBe(true);
    expect(canReadMobileSettingsAdministration("cashier")).toBe(false);
    expect(canReadMobileSettingsAdministration("warehouse")).toBe(false);
  });

  test("non-owner AI settings expose readiness without provider configuration", () => {
    const ai = parseStorePrefs({
      ai: {
        provider: "gemini",
        textModel: "gemini-2.5-pro",
        visionModel: "gemini-2.5-flash",
        openaiApiKey: "",
        openaiApiKeySet: true,
        attachmentsBucket: "private-ai-bucket",
        monthlyUsageLimit: 1234,
      },
    }).ai;

    const result = mobileAiSettingsForRole(ai, "cashier");

    expect(result).toEqual({ configured: true });
    expect(JSON.stringify(result)).not.toContain("gemini");
    expect(JSON.stringify(result)).not.toContain("private-ai-bucket");
    expect(JSON.stringify(result)).not.toContain("1234");
  });

  test("cashier notification payload omits store-wide routing settings", () => {
    const notifications = parseStorePrefs({
      notifications: {
        quietHours: {
          enabled: true,
          start: "22:00",
          end: "07:00",
          timezone: "Asia/Ho_Chi_Minh",
        },
      },
    }).notifications;

    expect(mobileNotificationSettingsForRole(notifications, "cashier"))
      .toBeUndefined();
  });

  test("AI usage administration is owner-only", () => {
    expect(canReadMobileAiAdministration("owner")).toBe(true);
    expect(canReadMobileAiAdministration("manager")).toBe(false);
    expect(canReadMobileAiAdministration("cashier")).toBe(false);
    expect(canReadMobileAiAdministration("warehouse")).toBe(false);
  });
});

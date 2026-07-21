import { describe, expect, test } from "bun:test";
import { pushDeviceBinding } from "../src/lib/notifications/device-binding";
import { isWithinQuietHours } from "../src/lib/notifications/policy";

describe("push device actor binding", () => {
  test("keeps shared terminal ownership on the principal while routing as the active cashier", () => {
    expect(pushDeviceBinding({
      principalId: "owner-1",
      userId: "cashier-1",
      role: "cashier",
    })).toEqual({
      principalId: "owner-1",
      effectiveUserId: "cashier-1",
    });
  });
});

describe("push notification quiet hours", () => {
  test("supports a quiet period spanning midnight", () => {
    const base = {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "Asia/Ho_Chi_Minh",
    };
    expect(isWithinQuietHours({ ...base, now: new Date("2026-07-19T16:00:00Z") }))
      .toBe(true); // 23:00 ICT
    expect(isWithinQuietHours({ ...base, now: new Date("2026-07-19T00:30:00Z") }))
      .toBe(false); // 07:30 ICT
  });

  test("supports same-day quiet periods and disabled mode", () => {
    const input = {
      enabled: true,
      start: "12:00",
      end: "14:00",
      timezone: "Asia/Ho_Chi_Minh",
      now: new Date("2026-07-19T06:00:00Z"), // 13:00 ICT
    };
    expect(isWithinQuietHours(input)).toBe(true);
    expect(isWithinQuietHours({ ...input, enabled: false })).toBe(false);
  });
});

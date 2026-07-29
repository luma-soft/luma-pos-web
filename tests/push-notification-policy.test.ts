import { describe, expect, test } from "bun:test";
import { pushDeviceBinding } from "../src/lib/notifications/device-binding";
import {
  buildFcmMessage,
  classifyFcmFailure,
} from "../src/lib/notifications/fcm-message";
import { isWithinQuietHours } from "../src/lib/notifications/policy";

const EVENT_ID = "11111111-1111-4111-8111-111111111110";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

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

describe("FCM notification boundary", () => {
  test("QR payload is high priority and privacy safe", () => {
    const payload = buildFcmMessage({
      token: "token",
      locale: "vi",
      eventId: EVENT_ID,
      notificationKey: `event:${EVENT_ID}`,
      category: "qrPaymentConfirmed",
      target: "invoices",
      entityId: ORDER_ID,
    });
    expect(payload.message.notification).toEqual({
      title: "Đã xác nhận thanh toán QR",
      body: "Mở LumaPOS để xem chi tiết.",
    });
    expect(payload.message.apns.headers).toMatchObject({
      "apns-priority": "10",
      "apns-push-type": "alert",
      "apns-collapse-id": `event:${EVENT_ID}`,
    });
    expect(payload.message.android.collapse_key).toBe(`event:${EVENT_ID}`);
    expect(JSON.stringify(payload)).not.toContain("1000000");
  });

  test("classifies retryable and permanent FCM failures", () => {
    expect(classifyFcmFailure(429, { error: { status: "RESOURCE_EXHAUSTED" } }))
      .toMatchObject({ kind: "retry" });
    expect(classifyFcmFailure(404, { error: { status: "UNREGISTERED" } }))
      .toEqual({ kind: "disable-token", code: "FCM_UNREGISTERED" });
    expect(classifyFcmFailure(401, { error: { status: "UNAUTHENTICATED" } }))
      .toEqual({ kind: "permanent", code: "FCM_UNAUTHENTICATED" });
  });

  test("disables only structured token-local invalid registrations", () => {
    expect(classifyFcmFailure(404, { error: { status: "NOT_FOUND" } }))
      .toEqual({ kind: "permanent", code: "FCM_NOT_FOUND" });
    expect(classifyFcmFailure(400, {
      error: {
        status: "INVALID_ARGUMENT",
        details: [{
          "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
          errorCode: "INVALID_ARGUMENT",
        }],
      },
    })).toEqual({ kind: "disable-token", code: "FCM_INVALID_TOKEN" });
  });

  test("treats structured sender-ID mismatch as token-local", () => {
    expect(classifyFcmFailure(403, {
      error: {
        status: "PERMISSION_DENIED",
        details: [{
          "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
          errorCode: "SENDER_ID_MISMATCH",
        }],
      },
    })).toEqual({
      kind: "disable-token",
      code: "FCM_SENDER_ID_MISMATCH",
    });
  });
});

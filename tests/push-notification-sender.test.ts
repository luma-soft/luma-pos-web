import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

const originalFetch = globalThis.fetch;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalFirebaseAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  project_id: "luma-test",
  client_email: "firebase-test@luma.test",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

const { sendNotificationToDevice } = await import("../src/lib/notifications/push");

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalFirebaseAccount === undefined) {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  } else {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalFirebaseAccount;
  }
});

const input = {
  token: "device-token",
  locale: "vi",
  eventId: "41111111-1111-4111-8111-111111111111",
  notificationKey: "event:41111111-1111-4111-8111-111111111111",
  category: "qrPaymentConfirmed" as const,
  target: "invoices" as const,
  entityId: "42222222-2222-4222-8222-222222222222",
};

describe("single-device FCM sender", () => {
  test("retries transient OAuth failures and coalesces the next cold refresh", async () => {
    let oauthCalls = 0;
    let fcmCalls = 0;
    let releaseRefresh: ((response: Response) => void) | undefined;
    const refresh = new Promise<Response>((resolve) => { releaseRefresh = resolve; });

    globalThis.fetch = async (request) => {
      const url = String(request);
      if (url === "https://oauth2.googleapis.com/token") {
        oauthCalls += 1;
        if (oauthCalls === 1) {
          return Response.json(
            { error: "temporarily_unavailable" },
            { status: 503, headers: { "retry-after": "120" } },
          );
        }
        return refresh;
      }
      fcmCalls += 1;
      return Response.json({ name: "accepted" });
    };

    await expect(sendNotificationToDevice(input)).resolves.toEqual({
      kind: "retry",
      code: "FCM_AUTH_UNAVAILABLE",
      retryAfterMs: 120_000,
    });

    const first = sendNotificationToDevice(input);
    const second = sendNotificationToDevice({ ...input, token: "second-token" });
    await Promise.resolve();
    await Promise.resolve();
    expect(oauthCalls).toBe(2);

    releaseRefresh?.(Response.json({
      access_token: "shared-access-token",
      expires_in: 3600,
    }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "sent" },
      { kind: "sent" },
    ]);
    expect(oauthCalls).toBe(2);
    expect(fcmCalls).toBe(2);
  });
});

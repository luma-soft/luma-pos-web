import { afterEach, describe, expect, mock, test } from "bun:test";
import { createNotificationOutboxMock } from "./helpers/notification-outbox-mock";

mock.module("@/lib/notifications/outbox", () => createNotificationOutboxMock({
  async recoverDueNotifications(limit: number) {
    return limit;
  },
}));

const originalCronSecret = process.env.CRON_SECRET;
const originalLegacySecret = process.env.NOTIFICATION_CRON_SECRET;

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
  if (originalLegacySecret === undefined) {
    delete process.env.NOTIFICATION_CRON_SECRET;
  } else {
    process.env.NOTIFICATION_CRON_SECRET = originalLegacySecret;
  }
});

describe("Vercel notification cron authorization", () => {
  test("accepts the hosting Authorization bearer from CRON_SECRET", async () => {
    process.env.CRON_SECRET = "vercel-cron-secret-value";
    process.env.NOTIFICATION_CRON_SECRET = "legacy-notification-secret";
    const { GET } = await import(
      `../src/app/api/cron/notifications/outbox/route.ts?primary=${Date.now()}`
    );

    const response = await GET(new Request("https://luma.test/api/cron/notifications/outbox", {
      headers: { authorization: "Bearer vercel-cron-secret-value" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { recovered: 50 },
    });
  });

  test("rejects missing, malformed, and wrong bearer values", async () => {
    process.env.CRON_SECRET = "vercel-cron-secret-value";
    delete process.env.NOTIFICATION_CRON_SECRET;
    const { GET } = await import(
      `../src/app/api/cron/notifications/outbox/route.ts?negative=${Date.now()}`
    );

    for (const authorization of [
      undefined,
      "Basic vercel-cron-secret-value",
      "Bearer",
      "Bearer wrong-value",
      "Bearer vercel-cron-secret-value-extra",
    ]) {
      const headers = authorization ? { authorization } : undefined;
      const response = await GET(new Request(
        "https://luma.test/api/cron/notifications/outbox",
        { headers },
      ));
      expect(response.status).toBe(401);
    }
  });

  test("accepts the explicitly configured legacy secret during migration", async () => {
    process.env.CRON_SECRET = "vercel-cron-secret-value";
    process.env.NOTIFICATION_CRON_SECRET = "legacy-notification-secret";
    const { GET } = await import(
      `../src/app/api/cron/notifications/outbox/route.ts?legacy=${Date.now()}`
    );

    const response = await GET(new Request("https://luma.test/api/cron/notifications/outbox", {
      headers: { authorization: "Bearer legacy-notification-secret" },
    }));

    expect(response.status).toBe(200);
  });

  test("fails closed when no cron secret is configured", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.NOTIFICATION_CRON_SECRET;
    const { GET } = await import(
      `../src/app/api/cron/notifications/outbox/route.ts?unconfigured=${Date.now()}`
    );

    const response = await GET(new Request("https://luma.test/api/cron/notifications/outbox", {
      headers: { authorization: "Bearer any-value" },
    }));

    expect(response.status).toBe(401);
  });
});

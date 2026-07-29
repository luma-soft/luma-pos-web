import { expect, mock, test } from "bun:test";

mock.module("@/lib/notifications/queue/config", () => ({
  resolveNotificationQueue() {
    return {
      provider: "qstash",
      verifier: {
        async verify() {
          return {
            version: 1 as const,
            eventId: "10000000-0000-4000-8000-000000000001",
            deduplicationKey:
              "notification:10000000-0000-4000-8000-000000000001",
            queuedAt: "2026-07-28T12:00:00.000Z",
          };
        },
      },
    };
  },
}));

mock.module("@/lib/notifications/outbox", () => ({
  async processNotificationMessage() {
    return { completed: false, reason: "not_ready" as const };
  },
  recordNotificationQueueRejection() {},
}));

const { POST } = await import(
  "../src/app/api/workers/notifications/push/route.ts"
);

test("worker returns retryable non-2xx when publication is not ready", async () => {
  const response = await POST(new Request(
    "https://pos.example.com/api/workers/notifications/push",
    { method: "POST" },
  ));

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    ok: false,
    error: "errors.conflict",
  });
});

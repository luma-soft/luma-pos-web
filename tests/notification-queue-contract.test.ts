import { describe, expect, test } from "bun:test";
import {
  NotificationQueueVerificationError,
  type NotificationQueueMessageV1,
  type NotificationQueuePublisher,
} from "../src/lib/notifications/contracts";
import { resolveNotificationQueue } from "../src/lib/notifications/queue/config";
import { createQstashNotificationQueue } from "../src/lib/notifications/queue/qstash";

const message: NotificationQueueMessageV1 = {
  version: 1,
  eventId: "10000000-0000-0000-0000-000000000001",
  deduplicationKey: "notification:10000000-0000-0000-0000-000000000001",
  queuedAt: "2026-07-28T12:00:00.000Z",
};

const config = {
  token: "qstash-token",
  workerUrl: "https://pos.example.com/api/workers/notifications/push",
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
};

describe("notification queue boundary", () => {
  test("rejects an unconfigured provider", () => {
    expect(() => resolveNotificationQueue({
      NOTIFICATION_QUEUE_PROVIDER: "qstash",
    })).toThrow("NOTIFICATION_QUEUE_NOT_CONFIGURED");
  });

  test("publisher transports only the neutral envelope", async () => {
    const published: unknown[] = [];
    const fake: NotificationQueuePublisher = {
      async publish(value) {
        published.push(value);
        return { providerMessageId: "fake-1" };
      },
    };

    await fake.publish(message);

    expect(published).toEqual([message]);
  });

  test("verifier checks the raw QStash request against the configured worker URL", async () => {
    const verificationInputs: Array<{ signature: string; body: string; url: string }> = [];
    const queue = createQstashNotificationQueue(config, {
      async verify(input) {
        verificationInputs.push(input);
        return true;
      },
    });
    const rawBody = JSON.stringify(message);

    await expect(queue.verifier.verify(new Request("https://untrusted.example/queue", {
      method: "POST",
      headers: { "Upstash-Signature": "signature-from-qstash" },
      body: rawBody,
    }))).resolves.toEqual(message);

    expect(verificationInputs).toEqual([{
      signature: "signature-from-qstash",
      body: rawBody,
      url: config.workerUrl,
    }]);
  });

  test("verifier reports an invalid signature without parsing the payload as trusted", async () => {
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return false;
      },
    });

    await expect(queue.verifier.verify(new Request(config.workerUrl, {
      method: "POST",
      headers: { "Upstash-Signature": "invalid-signature" },
      body: JSON.stringify(message),
    }))).rejects.toMatchObject<Partial<NotificationQueueVerificationError>>({
      reason: "invalid_signature",
    });
  });

  test("verifier rejects a signed payload that is not a version 1 queue envelope", async () => {
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return true;
      },
    });

    await expect(queue.verifier.verify(new Request(config.workerUrl, {
      method: "POST",
      headers: { "Upstash-Signature": "valid-signature" },
      body: JSON.stringify({ ...message, version: 2 }),
    }))).rejects.toMatchObject<Partial<NotificationQueueVerificationError>>({
      reason: "invalid_message",
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  NotificationQueueVerificationError,
  type NotificationQueueMessageV1,
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

  test("publisher sends a closed envelope with the required QStash delivery settings", async () => {
    const published: unknown[] = [];
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return true;
      },
    }, {
      async publishJSON(input) {
        published.push(input);
        return { messageId: "qstash-message-1" };
      },
    });
    const messageWithBusinessMetadata = {
      ...message,
      orderTotal: 750_000,
    };

    await expect(queue.publisher.publish(messageWithBusinessMetadata))
      .resolves.toEqual({ providerMessageId: "qstash-message-1" });

    expect(published).toEqual([{
      url: config.workerUrl,
      body: message,
      deduplicationId: message.deduplicationKey,
      retries: 10,
      retryDelay: "max(1000, pow(2, retried) * 1000)",
      timeout: "15s",
    }]);
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
      envelopeVersion: "v2",
    });
  });

  test("verifier rejects a signed payload with unexpected business metadata", async () => {
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return true;
      },
    });

    await expect(queue.verifier.verify(new Request(config.workerUrl, {
      method: "POST",
      headers: { "Upstash-Signature": "valid-signature" },
      body: JSON.stringify({ ...message, orderTotal: 750_000 }),
    }))).rejects.toMatchObject<Partial<NotificationQueueVerificationError>>({
      reason: "invalid_message",
    });
  });

  test("verifier rejects an impossible calendar date in a signed timestamp", async () => {
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return true;
      },
    });

    await expect(queue.verifier.verify(new Request(config.workerUrl, {
      method: "POST",
      headers: { "Upstash-Signature": "valid-signature" },
      body: JSON.stringify({ ...message, queuedAt: "2026-02-30T12:00:00.000Z" }),
    }))).rejects.toMatchObject<Partial<NotificationQueueVerificationError>>({
      reason: "invalid_message",
    });
  });

  test("verifier accepts a signed ISO timestamp with an offset", async () => {
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return true;
      },
    });
    const queuedAt = "2026-07-28T19:00:00+07:00";

    await expect(queue.verifier.verify(new Request(config.workerUrl, {
      method: "POST",
      headers: { "Upstash-Signature": "valid-signature" },
      body: JSON.stringify({ ...message, queuedAt }),
    }))).resolves.toEqual({ ...message, queuedAt });
  });

  test("verifier accepts a signed ISO timestamp without fractional seconds", async () => {
    const queue = createQstashNotificationQueue(config, {
      async verify() {
        return true;
      },
    });
    const queuedAt = "2026-07-28T12:00:00Z";

    await expect(queue.verifier.verify(new Request(config.workerUrl, {
      method: "POST",
      headers: { "Upstash-Signature": "valid-signature" },
      body: JSON.stringify({ ...message, queuedAt }),
    }))).resolves.toEqual({ ...message, queuedAt });
  });
});

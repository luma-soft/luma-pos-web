import { Client, Receiver } from "@upstash/qstash";
import {
  NotificationQueueVerificationError,
  type NotificationQueueMessageV1,
  type NotificationQueuePublisher,
  type NotificationQueueRequestVerifier,
} from "../contracts";

export type QstashNotificationQueueConfig = {
  token: string;
  workerUrl: string;
  currentSigningKey: string;
  nextSigningKey: string;
};

type QstashReceiverLike = {
  verify(input: {
    signature: string;
    body: string;
    url: string;
  }): Promise<boolean>;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function invalidMessage(): never {
  throw new NotificationQueueVerificationError("invalid_message");
}

function parseNotificationQueueMessage(body: string): NotificationQueueMessageV1 {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return invalidMessage();
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidMessage();

  const message = value as Record<string, unknown>;
  if (message.version !== 1) return invalidMessage();
  if (typeof message.eventId !== "string" || !uuidPattern.test(message.eventId)) return invalidMessage();
  if (
    typeof message.deduplicationKey !== "string"
    || !message.deduplicationKey.trim()
    || message.deduplicationKey.length > 200
  ) return invalidMessage();
  if (
    typeof message.queuedAt !== "string"
    || !isoTimestampPattern.test(message.queuedAt)
    || Number.isNaN(Date.parse(message.queuedAt))
  ) return invalidMessage();

  return {
    version: 1,
    eventId: message.eventId,
    deduplicationKey: message.deduplicationKey,
    queuedAt: message.queuedAt,
  };
}

export function createQstashNotificationQueue(
  config: QstashNotificationQueueConfig,
  injectedReceiver?: QstashReceiverLike,
): {
  publisher: NotificationQueuePublisher;
  verifier: NotificationQueueRequestVerifier;
} {
  const client = new Client({
    token: config.token,
    enableTelemetry: false,
  });
  const receiver = injectedReceiver ?? new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
  });

  return {
    publisher: {
      async publish(message) {
        const result = await client.publishJSON({
          url: config.workerUrl,
          body: message,
          deduplicationId: message.deduplicationKey,
          retries: 10,
          retryDelay: "max(1000, pow(2, retried) * 1000)",
          timeout: "15s",
        });

        return { providerMessageId: result.messageId };
      },
    },
    verifier: {
      async verify(request) {
        const body = await request.text();
        const signature = request.headers.get("Upstash-Signature");
        if (!signature) throw new NotificationQueueVerificationError("invalid_signature");

        try {
          const valid = await receiver.verify({
            signature,
            body,
            url: config.workerUrl,
          });
          if (!valid) throw new NotificationQueueVerificationError("invalid_signature");
        } catch (error) {
          if (error instanceof NotificationQueueVerificationError) throw error;
          throw new NotificationQueueVerificationError("invalid_signature");
        }

        return parseNotificationQueueMessage(body);
      },
    },
  };
}

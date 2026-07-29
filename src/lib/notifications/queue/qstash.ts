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

type QstashClientLike = {
  publishJSON(input: {
    url: string;
    body: NotificationQueueMessageV1;
    retries: 10;
    retryDelay: "max(1000, pow(2, retried) * 1000)";
    timeout: "15s";
  }): Promise<{ messageId: string }>;
};

const queueMessageKeys = ["version", "eventId", "deduplicationKey", "queuedAt"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function boundedEnvelopeVersion(value: unknown): string {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 999
    ? `v${value}`
    : "unknown";
}

function invalidMessage(envelopeVersion = "unknown"): never {
  throw new NotificationQueueVerificationError("invalid_message", envelopeVersion);
}

function isValidIsoTimestamp(value: string): boolean {
  const match = isoTimestampPattern.exec(value);
  if (!match) return false;

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue, offsetHourValue, offsetMinuteValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const offsetHour = offsetHourValue === undefined ? 0 : Number(offsetHourValue);
  const offsetMinute = offsetMinuteValue === undefined ? 0 : Number(offsetMinuteValue);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;

  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
    && !Number.isNaN(Date.parse(value));
}

function toNotificationQueueMessage(value: NotificationQueueMessageV1): NotificationQueueMessageV1 {
  return {
    version: value.version,
    eventId: value.eventId,
    deduplicationKey: value.deduplicationKey,
    queuedAt: value.queuedAt,
  };
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
  const envelopeVersion = boundedEnvelopeVersion(message.version);
  if (
    Object.keys(message).length !== queueMessageKeys.length
    || !queueMessageKeys.every((key) => Object.hasOwn(message, key))
  ) return invalidMessage(envelopeVersion);
  if (message.version !== 1) return invalidMessage(envelopeVersion);
  if (typeof message.eventId !== "string" || !uuidPattern.test(message.eventId)) {
    return invalidMessage(envelopeVersion);
  }
  if (
    typeof message.deduplicationKey !== "string"
    || !message.deduplicationKey.trim()
    || message.deduplicationKey.length > 200
  ) return invalidMessage(envelopeVersion);
  if (
    typeof message.queuedAt !== "string"
    || !isValidIsoTimestamp(message.queuedAt)
  ) return invalidMessage(envelopeVersion);

  return toNotificationQueueMessage({
    version: 1,
    eventId: message.eventId,
    deduplicationKey: message.deduplicationKey,
    queuedAt: message.queuedAt,
  });
}

export function createQstashNotificationQueue(
  config: QstashNotificationQueueConfig,
  injectedReceiver?: QstashReceiverLike,
  injectedClient?: QstashClientLike,
): {
  publisher: NotificationQueuePublisher;
  verifier: NotificationQueueRequestVerifier;
} {
  const sdkClient = new Client({
    token: config.token,
    enableTelemetry: false,
  });
  const publish = injectedClient
    ? (input: Parameters<QstashClientLike["publishJSON"]>[0]) => injectedClient.publishJSON(input)
    : async (input: Parameters<QstashClientLike["publishJSON"]>[0]) => {
      const result = await sdkClient.publishJSON({
        url: input.url,
        body: input.body,
        retries: 10,
        retryDelay: "max(1000, pow(2, retried) * 1000)",
        timeout: "15s",
      });
      return { messageId: result.messageId };
    };
  const receiver = injectedReceiver ?? new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
  });

  return {
    publisher: {
      async publish(message) {
        const envelope = toNotificationQueueMessage(message);
        const result = await publish({
          url: config.workerUrl,
          body: envelope,
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

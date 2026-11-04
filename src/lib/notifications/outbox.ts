import { db } from "@/db";
import { after } from "next/server";
import type { NotificationQueueMessageV1 } from "@/lib/notifications/contracts";
import { createNotificationOutboxCore } from "@/lib/notifications/outbox-core";
import { resolveNotificationQueue } from "@/lib/notifications/queue/config";
import { sendNotificationToDevice } from "@/lib/notifications/push";

type QueueRejectionClass = "invalid_signature" | "invalid_message";

const queueRejectionCounters = new Map<string, number>();

export function recordNotificationQueueRejection(
  resultClass: QueueRejectionClass,
  provider = "qstash",
  envelopeVersion = "unknown",
) {
  const safeVersion = envelopeVersion === "unknown" || /^v\d{1,3}$/.test(envelopeVersion)
    ? envelopeVersion
    : "unknown";
  const key = JSON.stringify({ provider, resultClass, envelopeVersion: safeVersion });
  queueRejectionCounters.set(key, (queueRejectionCounters.get(key) ?? 0) + 1);
}

function productionCore() {
  try {
    const queue = resolveNotificationQueue();
    return createNotificationOutboxCore({
      database: db,
      publisher: queue.publisher,
      sender: sendNotificationToDevice,
      provider: queue.provider,
    });
  } catch {
    return createNotificationOutboxCore({
      database: db,
      publisher: {
        async publish() {
          throw new Error("NOTIFICATION_QUEUE_NOT_CONFIGURED");
        },
      },
      sender: sendNotificationToDevice,
      provider: "unconfigured",
    });
  }
}

/** Queue the durable outbox event after the response so push latency cannot hold a business mutation open. */
export async function publishCommittedNotification(eventId: string): Promise<void> {
  after(async () => {
    try {
      await productionCore().publishCommittedNotification(eventId);
    } catch {
      console.error("Committed notification publication failed");
    }
  });
}

export async function recoverDueNotifications(limit = 50): Promise<number> {
  return productionCore().recoverDueNotifications(limit);
}

export async function processNotificationMessage(
  message: NotificationQueueMessageV1,
) {
  return productionCore().processNotificationMessage(message);
}

export async function republishDeadNotification(
  userId: string,
  eventId: string,
) {
  return productionCore().republishDeadNotificationForUser(userId, eventId);
}

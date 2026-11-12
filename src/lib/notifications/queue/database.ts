import { NotificationQueueVerificationError } from "@/lib/notifications/contracts";
import type {
  NotificationQueueMessageV1,
  NotificationQueuePublisher,
  NotificationQueueRequestVerifier,
} from "@/lib/notifications/contracts";

export function createDatabaseNotificationQueue(): {
  publisher: NotificationQueuePublisher;
  verifier: NotificationQueueRequestVerifier;
} {
  return {
    publisher: {
      async publish(message: NotificationQueueMessageV1) {
        return { providerMessageId: `database:${message.eventId}` };
      },
    },
    verifier: {
      async verify(_request: Request): Promise<NotificationQueueMessageV1> {
        throw new NotificationQueueVerificationError("invalid_signature", "database");
      },
    },
  };
}

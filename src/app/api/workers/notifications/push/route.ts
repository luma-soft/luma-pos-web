import {
  NotificationQueueVerificationError,
  type NotificationQueueMessageV1,
} from "@/lib/notifications/contracts";
import {
  processNotificationMessage,
  recordNotificationQueueRejection,
} from "@/lib/notifications/outbox";
import { resolveNotificationQueue } from "@/lib/notifications/queue/config";
import { mobileError, mobileOk } from "@/lib/mobile/response";

export async function POST(request: Request) {
  let queue: ReturnType<typeof resolveNotificationQueue>;
  try {
    queue = resolveNotificationQueue();
  } catch {
    return mobileError("errors.serverError", 500);
  }

  let message: NotificationQueueMessageV1;
  try {
    message = await queue.verifier.verify(request);
  } catch (error) {
    if (
      error instanceof NotificationQueueVerificationError
      && error.reason === "invalid_message"
    ) {
      recordNotificationQueueRejection(
        "invalid_message",
        queue.provider,
        error.envelopeVersion,
      );
      return mobileError("errors.invalidData", 400);
    }
    recordNotificationQueueRejection("invalid_signature", queue.provider, "unknown");
    return mobileError("errors.unauthorized", 401);
  }

  try {
    return mobileOk(await processNotificationMessage(message));
  } catch {
    return mobileError("errors.serverError", 500);
  }
}

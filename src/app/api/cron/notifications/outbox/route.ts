import { recoverDueNotifications } from "@/lib/notifications/outbox";
import { isNotificationCronAuthorized } from "@/lib/notifications/cron-auth";
import { mobileError, mobileOk } from "@/lib/mobile/response";

export async function GET(request: Request) {
  if (!isNotificationCronAuthorized(request)) {
    return mobileError("errors.unauthorized", 401);
  }

  try {
    const recovered = await recoverDueNotifications(50);
    return mobileOk({ recovered });
  } catch {
    return mobileError("errors.serverError", 500);
  }
}

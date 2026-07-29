import { timingSafeEqual } from "node:crypto";
import { recoverDueNotifications } from "@/lib/notifications/outbox";
import { mobileError, mobileOk } from "@/lib/mobile/response";

function authorized(request: Request) {
  const expected = process.env.NOTIFICATION_CRON_SECRET?.trim() ?? "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return mobileError("errors.unauthorized", 401);

  try {
    const recovered = await recoverDueNotifications(50);
    return mobileOk({ recovered });
  } catch {
    return mobileError("errors.serverError", 500);
  }
}

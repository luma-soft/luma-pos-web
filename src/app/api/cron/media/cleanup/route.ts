import { timingSafeEqual } from "node:crypto";

import {
  drainMediaCleanup,
  type MediaCleanupResult,
} from "@/lib/media/cleanup";
import { mobileError, mobileOk } from "@/lib/mobile/response";

export function isMediaCleanupCronAuthorized(request: Request) {
  const expected = (process.env.CRON_SECRET ?? "").trim();
  const actual = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim() ?? "";
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function handleMediaCleanupRequest(
  request: Request,
  dependencies: {
    drain: () => Promise<MediaCleanupResult>;
  } = { drain: () => drainMediaCleanup() },
) {
  if (!isMediaCleanupCronAuthorized(request)) {
    return mobileError("errors.unauthorized", 401);
  }
  try {
    return mobileOk(await dependencies.drain());
  } catch {
    return mobileError("errors.serverError", 500);
  }
}

export function GET(request: Request) {
  return handleMediaCleanupRequest(request);
}

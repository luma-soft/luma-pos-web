import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeMatch(actual: string, expected: string) {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function isNotificationCronAuthorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] ?? "";
  const secrets = [
    process.env.CRON_SECRET?.trim() ?? "",
    process.env.NOTIFICATION_CRON_SECRET?.trim() ?? "",
  ].filter((secret, index, values) =>
    secret.length > 0 && values.indexOf(secret) === index
  );
  if (!bearer || secrets.length === 0) return false;

  // Evaluate every configured candidate so the compatibility fallback does not
  // introduce a secret-dependent early-return timing branch.
  return secrets.reduce(
    (matched, secret) => constantTimeMatch(bearer, secret) || matched,
    false,
  );
}

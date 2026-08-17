export const NOTIFICATION_INBOX_ENDPOINT = "/api/mobile/notifications?locale=vi";
export const NOTIFICATION_INBOX_CHANGED_EVENT = "luma:notification-inbox-changed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function notificationUnreadCountFromPayload(payload: unknown): number | null {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.data)) return null;
  const counts = payload.data.counts;
  if (!isRecord(counts)) return null;
  const unread = counts.unread;
  return typeof unread === "number" && Number.isSafeInteger(unread) && unread >= 0
    ? unread
    : null;
}

export async function fetchNotificationUnreadCount(
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const response = await fetcher(NOTIFICATION_INBOX_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error("notifications_failed");
  const count = notificationUnreadCountFromPayload(await response.json());
  if (count === null) throw new Error("notifications_failed");
  return count;
}

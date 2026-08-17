import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  fetchNotificationUnreadCount,
  NOTIFICATION_INBOX_CHANGED_EVENT,
  NOTIFICATION_INBOX_ENDPOINT,
  notificationUnreadCountFromPayload,
} from "@/lib/notifications/inbox-count";

describe("notification navigation badge", () => {
  test("uses the notification inbox instead of the audit attention counter", () => {
    const layoutSource = readFileSync("src/app/(app)/layout.tsx", "utf8");
    const navSource = readFileSync("src/components/app-nav.tsx", "utf8");

    expect(layoutSource).not.toContain("getAttentionNotificationCount");
    expect(navSource).toContain("fetchNotificationUnreadCount");
  });

  test("reads the unread count from the shared inbox response", async () => {
    expect(notificationUnreadCountFromPayload({
      ok: true,
      data: { counts: { unread: 0 } },
    })).toBe(0);
    expect(notificationUnreadCountFromPayload({
      ok: true,
      data: { counts: { unread: 7 } },
    })).toBe(7);
    expect(notificationUnreadCountFromPayload({
      ok: true,
      data: { counts: { unread: -1 } },
    })).toBeNull();

    let requestedUrl = "";
    let requestedCache: RequestCache | undefined;
    const count = await fetchNotificationUnreadCount(async (input, init) => {
      requestedUrl = String(input);
      requestedCache = init?.cache;
      return new Response(JSON.stringify({
        ok: true,
        data: { counts: { unread: 3 } },
      }));
    });

    expect(count).toBe(3);
    expect(requestedUrl).toBe(NOTIFICATION_INBOX_ENDPOINT);
    expect(requestedCache).toBe("no-store");
  });

  test("refreshes the badge after inbox rows are changed", () => {
    const navSource = readFileSync("src/components/app-nav.tsx", "utf8");
    const inboxSource = readFileSync(
      "src/app/(app)/notifications/notifications-client.tsx",
      "utf8",
    );
    const activitySource = readFileSync(
      "src/app/(app)/notifications/notifications-table.tsx",
      "utf8",
    );

    expect(navSource).toContain(
      "window.addEventListener(NOTIFICATION_INBOX_CHANGED_EVENT, handleInboxChanged)",
    );
    expect(inboxSource).toContain(
      "window.dispatchEvent(new Event(NOTIFICATION_INBOX_CHANGED_EVENT))",
    );
    expect(activitySource).toContain(
      "window.dispatchEvent(new Event(NOTIFICATION_INBOX_CHANGED_EVENT))",
    );
    expect(NOTIFICATION_INBOX_CHANGED_EVENT).toBe("luma:notification-inbox-changed");
  });
});

import { describe, expect, test } from "bun:test";
import { notificationUnreadCountFromPayload } from "./inbox-count.ts";

describe("notificationUnreadCountFromPayload", () => {
  test("uses the server-wide unread count instead of the capped feed rows", () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `notification-${index}`,
      unread: true,
    }));

    expect(notificationUnreadCountFromPayload({
      ok: true,
      data: { rows, counts: { all: 120, unread: 108 } },
    })).toBe(108);
  });

  test("rejects invalid unread counts", () => {
    expect(notificationUnreadCountFromPayload({
      ok: true,
      data: { counts: { unread: -1 } },
    })).toBeNull();
  });
});

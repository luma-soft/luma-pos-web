import { describe, expect, test } from "bun:test";
import {
  applyNotificationFilters,
  countActiveNotificationFilters,
  defaultNotificationFilters,
  isActionableNotification,
  notificationCategory,
  type NotificationRow,
} from "@/app/(app)/notifications/notification-view-model";

const rows: NotificationRow[] = [
  {
    id: "stock",
    category: "lowStock",
    title: "Low stock",
    body: "Four rolls remain",
    unread: true,
    priority: "high",
    createdAt: "2026-08-10T03:30:00.000Z",
  },
  {
    id: "report",
    category: "invoiceCreated",
    title: "Daily report",
    body: "Ready",
    unread: false,
    priority: "low",
    createdAt: "2026-08-09T13:30:00.000Z",
  },
];

describe("notification inbox filters", () => {
  test("separates actionable work from informational events", () => {
    expect(isActionableNotification(rows[0])).toBe(true);
    expect(isActionableNotification(rows[1])).toBe(false);
    expect(notificationCategory("lowStock")).toBe("inventory");
    expect(notificationCategory("invoiceCreated")).toBe("sales");
  });

  test("combines status, level, category, source, and time filters", () => {
    const filtered = applyNotificationFilters(
      rows,
      {
        ...defaultNotificationFilters,
        timePreset: "7d",
        status: "action",
        level: "high",
        category: "inventory",
        source: "ai",
      },
      "action",
      new Date("2026-08-10T12:00:00+07:00"),
    );

    expect(filtered.map((row) => row.id)).toEqual(["stock"]);
  });

  test("counts each active filter group once", () => {
    expect(countActiveNotificationFilters({
      ...defaultNotificationFilters,
      timePreset: "30d",
      status: "unread",
      category: "inventory",
    })).toBe(3);
  });
});

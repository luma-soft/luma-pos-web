import { describe, expect, test } from "bun:test";
import { paginateNotificationRows } from "./notification-view-model.ts";

describe("paginateNotificationRows", () => {
  const rows = Array.from({ length: 34 }, (_, index) => index + 1);

  test("returns the requested page and total metadata", () => {
    expect(paginateNotificationRows(rows, 2, 15)).toEqual({
      rows: Array.from({ length: 15 }, (_, index) => index + 16),
      total: 34,
      page: 2,
      pageCount: 3,
      pageSize: 15,
    });
  });

  test("clamps a stale page after filtering or resolving rows", () => {
    expect(paginateNotificationRows(rows.slice(0, 4), 3, 15)).toEqual({
      rows: [1, 2, 3, 4],
      total: 4,
      page: 1,
      pageCount: 1,
      pageSize: 15,
    });
  });
});

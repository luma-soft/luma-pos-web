import { describe, expect, test } from "bun:test";

import { toMobileAuditLog } from "./mobile-audit.ts";

describe("toMobileAuditLog", () => {
  test("keeps the activity details needed by the mobile client", () => {
    const createdAt = new Date("2026-09-07T16:41:00.000Z");
    const row = {
      id: "audit-1",
      actorNameSnapshot: null,
      source: "mobile",
      action: "project.deleted",
      entityType: "project",
      entityId: "project-1",
      status: "succeeded",
      prompt: "Xóa công trình",
      parsedIntent: { action: "delete" },
      before: { name: "Test" },
      after: null,
      affectedRecords: [{ id: "project-1", name: "Test" }],
      metadata: { deleted: true },
      resolvedEntity: { id: "project-1", type: "project", code: null, name: "Test" },
      createdAt,
    };

    expect(toMobileAuditLog(row)).toEqual({
      ...row,
      resolvedEntity: row.resolvedEntity,
      createdAt: createdAt.toISOString(),
    });
  });
});

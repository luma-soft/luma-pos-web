import { describe, expect, test } from "bun:test";
import {
  canReadMobileAuditLog,
  toMobileAuditLog,
} from "../src/lib/audit/mobile-audit";

describe("mobile audit access", () => {
  test("only managers and owners can read the store audit stream", () => {
    expect(canReadMobileAuditLog("owner")).toBe(true);
    expect(canReadMobileAuditLog("manager")).toBe(true);
    expect(canReadMobileAuditLog("cashier")).toBe(false);
    expect(canReadMobileAuditLog("warehouse")).toBe(false);
  });

  test("mobile audit rows exclude prompts, record snapshots, and metadata", () => {
    const row = toMobileAuditLog({
      id: "audit-1",
      actorId: "staff-secret-id",
      actorNameSnapshot: "Store Manager",
      source: "mobile",
      action: "customer_delete",
      entityType: "customer",
      entityId: "customer-1",
      status: "succeeded",
      prompt: "Delete customer phone 0900000000",
      parsedIntent: { phone: "0900000000" },
      before: { phone: "0900000000" },
      after: null,
      affectedRecords: [{ phone: "0900000000" }],
      metadata: { email: "customer@example.com" },
      createdAt: new Date("2026-07-20T08:00:00.000Z"),
    });

    expect(row).toEqual({
      id: "audit-1",
      actorNameSnapshot: "Store Manager",
      source: "mobile",
      action: "customer_delete",
      entityType: "customer",
      entityId: "customer-1",
      status: "succeeded",
      createdAt: "2026-07-20T08:00:00.000Z",
    });
    expect(JSON.stringify(row)).not.toContain("0900000000");
    expect(JSON.stringify(row)).not.toContain("customer@example.com");
    expect(JSON.stringify(row)).not.toContain("staff-secret-id");
  });
});

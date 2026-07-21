import { describe, expect, test } from "bun:test";
import {
  approvalModeFor,
  createApprovalCredential,
  hashApprovalToken,
} from "../src/lib/auth/mobile-approval";

describe("mobile approval credentials", () => {
  test("manager re-auth must use the same manager identity", () => {
    expect(approvalModeFor({
      requesterRole: "manager",
      requesterId: "manager-1",
      approverRole: "manager",
      approverId: "manager-1",
      permission: "refund.create",
    })).toBe("reauth");

    expect(approvalModeFor({
      requesterRole: "manager",
      requesterId: "manager-1",
      approverRole: "owner",
      approverId: "owner-1",
      permission: "refund.create",
    })).toBeNull();
  });

  test("cashier sensitive action requires a manager or owner", () => {
    expect(approvalModeFor({
      requesterRole: "cashier",
      requesterId: "cashier-1",
      approverRole: "manager",
      approverId: "manager-1",
      permission: "order.void",
    })).toBe("manager");

    expect(approvalModeFor({
      requesterRole: "cashier",
      requesterId: "cashier-1",
      approverRole: "cashier",
      approverId: "cashier-2",
      permission: "order.void",
    })).toBeNull();
  });

  test("permissions not granted by the matrix cannot obtain an approval", () => {
    expect(approvalModeFor({
      requesterRole: "warehouse",
      requesterId: "warehouse-1",
      approverRole: "owner",
      approverId: "owner-1",
      permission: "refund.create",
    })).toBeNull();
  });

  test("raw token is random and only its stable hash needs persistence", () => {
    const first = createApprovalCredential();
    const second = createApprovalCredential();

    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(40);
    expect(first.tokenHash).toBe(hashApprovalToken(first.token));
    expect(first.tokenHash).not.toContain(first.token);
  });
});

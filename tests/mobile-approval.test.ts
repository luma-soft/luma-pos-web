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
      requesterStoreId: "store-a",
      approverRole: "manager",
      approverId: "manager-1",
      approverStoreId: "store-a",
      permission: "refund.create",
    })).toBe("reauth");

    expect(approvalModeFor({
      requesterRole: "manager",
      requesterId: "manager-1",
      requesterStoreId: "store-a",
      approverRole: "owner",
      approverId: "owner-1",
      approverStoreId: "store-a",
      permission: "refund.create",
    })).toBeNull();
  });

  test("cashier sensitive action requires a manager or owner", () => {
    expect(approvalModeFor({
      requesterRole: "cashier",
      requesterId: "cashier-1",
      requesterStoreId: "store-a",
      approverRole: "manager",
      approverId: "manager-1",
      approverStoreId: "store-a",
      permission: "order.void",
    })).toBe("manager");

    expect(approvalModeFor({
      requesterRole: "cashier",
      requesterId: "cashier-1",
      requesterStoreId: "store-a",
      approverRole: "cashier",
      approverId: "cashier-2",
      approverStoreId: "store-a",
      permission: "order.void",
    })).toBeNull();
  });

  test("permissions not granted by the matrix cannot obtain an approval", () => {
    expect(approvalModeFor({
      requesterRole: "warehouse",
      requesterId: "warehouse-1",
      requesterStoreId: "store-a",
      approverRole: "owner",
      approverId: "owner-1",
      approverStoreId: "store-a",
      permission: "refund.create",
    })).toBeNull();
  });

  test("never issues approval across stores", () => {
    expect(approvalModeFor({
      requesterRole: "cashier",
      requesterId: "cashier-a",
      requesterStoreId: "store-a",
      approverRole: "owner",
      approverId: "owner-b",
      approverStoreId: "store-b",
      permission: "order.void",
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

import { describe, expect, test } from "bun:test";
import {
  approvalModeFor,
  authorizeMobileSensitiveAction,
  createApprovalCredential,
  hashApprovalToken,
} from "../src/lib/auth/mobile-approval";

describe("mobile approval credentials", () => {
  test("owner sensitive actions succeed without an approval token", async () => {
    const result = await authorizeMobileSensitiveAction({
      request: new Request("https://lumapos.test/api/mobile/invoices/order-1/cancel"),
      storeId: "store-a",
      requesterId: "owner-1",
      requesterRole: "owner",
      permission: "order.void",
      scope: "order:order-1",
    });

    expect(result).toEqual({ ok: true });
  });

  test("restricted roles are denied without exposing the hidden PIN flow", async () => {
    const result = await authorizeMobileSensitiveAction({
      request: new Request("https://lumapos.test/api/mobile/invoices/order-1/cancel"),
      storeId: "store-a",
      requesterId: "cashier-1",
      requesterRole: "cashier",
      permission: "order.void",
      scope: "order:order-1",
    });

    expect(result).toEqual({ ok: false, error: "errors.forbidden" });
  });

  test("hidden PIN flow does not issue credentials for manager actions", () => {
    expect(approvalModeFor({
      requesterRole: "manager",
      requesterId: "manager-1",
      requesterStoreId: "store-a",
      approverRole: "manager",
      approverId: "manager-1",
      approverStoreId: "store-a",
      permission: "refund.create",
    })).toBeNull();

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

  test("hidden PIN flow does not issue credentials for cashier actions", () => {
    expect(approvalModeFor({
      requesterRole: "cashier",
      requesterId: "cashier-1",
      requesterStoreId: "store-a",
      approverRole: "manager",
      approverId: "manager-1",
      approverStoreId: "store-a",
      permission: "order.void",
    })).toBeNull();

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

import { describe, expect, test } from "bun:test";
import { permissionMatrixForRole } from "../src/lib/auth/mobile-permissions";

describe("mobile permission matrix", () => {
  test("cashier must obtain manager approval for sensitive sale actions", () => {
    const permissions = permissionMatrixForRole("cashier");

    expect(permissions["pos.sell"].allowed).toBe(true);
    expect(permissions["price.override"].allowed).toBe(false);
    expect(permissions["price.override"].managerApprovalAllowed).toBe(true);
    expect(permissions["refund.create"].managerApprovalAllowed).toBe(true);
    expect(permissions["cash.manage"].managerApprovalAllowed).toBe(true);
    expect(permissions["customer.erase"].allowed).toBe(false);
  });

  test("warehouse needs approval for stock adjustment and cannot refund", () => {
    const permissions = permissionMatrixForRole("warehouse");

    expect(permissions["catalog.manage"].allowed).toBe(true);
    expect(permissions["stock.adjust"].allowed).toBe(false);
    expect(permissions["stock.adjust"].managerApprovalAllowed).toBe(true);
    expect(permissions["refund.create"].managerApprovalAllowed).toBe(false);
  });

  test("manager can perform sensitive operations after re-auth", () => {
    const permissions = permissionMatrixForRole("manager");

    expect(permissions["refund.create"]).toEqual({
      allowed: true,
      reauthRequired: true,
      managerApprovalAllowed: false,
    });
    expect(permissions["settings.sensitive"]).toEqual({
      allowed: true,
      reauthRequired: true,
      managerApprovalAllowed: false,
    });
    expect(permissions["cash.manage"].reauthRequired).toBe(true);
    expect(permissions["payment.reconcile"].reauthRequired).toBe(true);
    expect(permissions["customer.erase"].reauthRequired).toBe(true);
  });
});

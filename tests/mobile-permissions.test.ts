import { describe, expect, test } from "bun:test";
import {
  mobilePermissionKeys,
  permissionMatrixForRole,
} from "../src/lib/auth/mobile-permissions";

describe("mobile permission matrix", () => {
  test("cashier cannot open the hidden sensitive approval flow", () => {
    const permissions = permissionMatrixForRole("cashier");

    expect(permissions["pos.sell"].allowed).toBe(true);
    expect(permissions["price.override"].allowed).toBe(false);
    expect(permissions["price.override"].managerApprovalAllowed).toBe(false);
    expect(permissions["refund.create"].managerApprovalAllowed).toBe(false);
    expect(permissions["cash.manage"].managerApprovalAllowed).toBe(false);
    expect(permissions["customer.erase"].allowed).toBe(false);
  });

  test("warehouse cannot open the hidden stock approval flow", () => {
    const permissions = permissionMatrixForRole("warehouse");

    expect(permissions["catalog.manage"].allowed).toBe(true);
    expect(permissions["stock.adjust"].allowed).toBe(false);
    expect(permissions["stock.adjust"].managerApprovalAllowed).toBe(false);
    expect(permissions["refund.create"].managerApprovalAllowed).toBe(false);
  });

  test("owner has every mobile permission without PIN", () => {
    const permissions = permissionMatrixForRole("owner");

    for (const permission of mobilePermissionKeys) {
      expect(permissions[permission]).toEqual({
        allowed: true,
        reauthRequired: false,
        managerApprovalAllowed: false,
      });
    }
  });

  test("manager uses granted sensitive permissions without PIN while approval is hidden", () => {
    const permissions = permissionMatrixForRole("manager");

    expect(permissions["refund.create"]).toEqual({
      allowed: true,
      reauthRequired: false,
      managerApprovalAllowed: false,
    });
    expect(permissions["settings.sensitive"]).toEqual({
      allowed: true,
      reauthRequired: false,
      managerApprovalAllowed: false,
    });
    expect(permissions["service.credentials"]).toEqual({
      allowed: true,
      reauthRequired: false,
      managerApprovalAllowed: false,
    });
    expect(permissions["cash.manage"].reauthRequired).toBe(false);
    expect(permissions["payment.reconcile"].reauthRequired).toBe(false);
    expect(permissions["customer.erase"].reauthRequired).toBe(false);
  });

  test("technician can perform field service without commercial access", () => {
    const permissions = permissionMatrixForRole("technician");

    expect(permissions["service.field"].allowed).toBe(true);
    expect(permissions["service.credentials"].allowed).toBe(false);
    expect(permissions["dashboard.view"].allowed).toBe(true);
    expect(permissions["pos.sell"].allowed).toBe(false);
    expect(permissions["catalog.manage"].allowed).toBe(false);
    expect(permissions["reports.view"].allowed).toBe(false);
    expect(permissions["cash.manage"].managerApprovalAllowed).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  canApplyStaffSettingsMutation,
  canResetStaffPin,
  parseStaffSettingsMutation,
} from "../src/lib/settings/staff-settings-mutation";

describe("mobile staff settings mutation", () => {
  test("binds a role change to the target staff member and role action", () => {
    expect(parseStaffSettingsMutation({ id: "staff-1", role: "manager" })).toEqual({
      action: "role",
      id: "staff-1",
      role: "manager",
      scope: "settings:staff:staff-1:role",
    });
  });

  test("binds an access-status change to a separate active action", () => {
    expect(parseStaffSettingsMutation({ id: "staff-1", active: false })).toEqual({
      action: "active",
      active: false,
      id: "staff-1",
      scope: "settings:staff:staff-1:active",
    });
  });

  test("rejects compound role and access-status changes", () => {
    expect(
      parseStaffSettingsMutation({
        id: "staff-1",
        role: "manager",
        active: false,
      }),
    ).toBeNull();
  });

  test("prevents managers from granting or modifying owner authority", () => {
    const managerContext = {
      actorId: "manager-1",
      actorRole: "manager" as const,
      activeOwnerCount: 1,
      targetActive: true,
      targetId: "staff-1",
    };
    expect(
      canApplyStaffSettingsMutation(
        { ...managerContext, targetRole: "cashier" },
        parseStaffSettingsMutation({ id: "staff-1", role: "owner" })!,
      ),
    ).toBe(false);
    expect(
      canApplyStaffSettingsMutation(
        { ...managerContext, targetRole: "owner" },
        parseStaffSettingsMutation({ id: "staff-1", active: false })!,
      ),
    ).toBe(false);
  });

  test("prevents an operator from changing their own role or disabling access", () => {
    const selfContext = {
      actorId: "owner-1",
      actorRole: "owner" as const,
      activeOwnerCount: 2,
      targetActive: true,
      targetId: "owner-1",
      targetRole: "owner" as const,
    };
    expect(
      canApplyStaffSettingsMutation(
        selfContext,
        parseStaffSettingsMutation({ id: "owner-1", role: "manager" })!,
      ),
    ).toBe(false);
    expect(
      canApplyStaffSettingsMutation(
        selfContext,
        parseStaffSettingsMutation({ id: "owner-1", active: false })!,
      ),
    ).toBe(false);
  });

  test("keeps the last active owner privileged and active", () => {
    const lastOwnerContext = {
      actorId: "owner-2",
      actorRole: "owner" as const,
      activeOwnerCount: 1,
      targetActive: true,
      targetId: "owner-1",
      targetRole: "owner" as const,
    };
    expect(
      canApplyStaffSettingsMutation(
        lastOwnerContext,
        parseStaffSettingsMutation({ id: "owner-1", role: "manager" })!,
      ),
    ).toBe(false);
    expect(
      canApplyStaffSettingsMutation(
        lastOwnerContext,
        parseStaffSettingsMutation({ id: "owner-1", active: false })!,
      ),
    ).toBe(false);
  });

  test("prevents a manager from resetting an owner cashier PIN", () => {
    expect(canResetStaffPin({ actorRole: "manager", targetRole: "owner" })).toBe(
      false,
    );
    expect(canResetStaffPin({ actorRole: "owner", targetRole: "owner" })).toBe(
      true,
    );
  });
});

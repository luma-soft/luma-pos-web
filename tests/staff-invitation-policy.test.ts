import { describe, expect, test } from "bun:test";
import {
  canInviteStaffRole,
  invitationMatchesAccount,
} from "../src/lib/auth/staff-invitation-policy";

describe("staff invitation policy", () => {
  test("owners can invite every staff role while managers cannot grant owner", () => {
    expect(canInviteStaffRole("owner", "owner")).toBe(true);
    expect(canInviteStaffRole("manager", "cashier")).toBe(true);
    expect(canInviteStaffRole("manager", "owner")).toBe(false);
    expect(canInviteStaffRole("cashier", "cashier")).toBe(false);
  });

  test("binds acceptance to the invited email or normalized phone", () => {
    expect(invitationMatchesAccount(
      { email: "staff@example.com", phoneNormalized: null },
      { email: "STAFF@example.com", phone: null },
    )).toBe(true);
    expect(invitationMatchesAccount(
      { email: null, phoneNormalized: "+84901234567" },
      { email: null, phone: "0901 234 567" },
    )).toBe(true);
    expect(invitationMatchesAccount(
      { email: "staff@example.com", phoneNormalized: null },
      { email: "attacker@example.com", phone: null },
    )).toBe(false);
  });
});

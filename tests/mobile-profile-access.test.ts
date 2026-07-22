import { describe, expect, test } from "bun:test";
import { activeProfile } from "@/lib/auth/profile-access";

describe("active profile access", () => {
  test("rejects a missing profile", () => {
    expect(activeProfile(undefined)).toBeNull();
  });

  test("rejects an inactive profile", () => {
    expect(activeProfile({ role: "manager", isActive: false })).toBeNull();
  });

  test("preserves an active profile role", () => {
    expect(activeProfile({ role: "cashier", isActive: true })).toEqual({
      role: "cashier",
      isActive: true,
    });
  });
});

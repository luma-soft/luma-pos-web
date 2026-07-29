import { describe, expect, test } from "bun:test";
import {
  createCustomerRequestToken,
  hashCustomerRequestToken,
  isCustomerRequestTokenUsable,
} from "../src/lib/services/customer-request-token";

describe("customer service request token", () => {
  test("creates an opaque token and stores only a stable hash", () => {
    const token = createCustomerRequestToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashCustomerRequestToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCustomerRequestToken(token)).toBe(hashCustomerRequestToken(token));
  });

  test("rejects expired or already submitted links", () => {
    const now = new Date("2026-07-29T00:00:00.000Z");
    expect(isCustomerRequestTokenUsable({
      status: "new",
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      now,
    })).toBe(true);
    expect(isCustomerRequestTokenUsable({
      status: "triaged",
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      now,
    })).toBe(false);
    expect(isCustomerRequestTokenUsable({
      status: "new",
      expiresAt: new Date("2026-07-28T00:00:00.000Z"),
      now,
    })).toBe(false);
  });
});

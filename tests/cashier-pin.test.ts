import { describe, expect, test } from "bun:test";
import {
  createCashierContextToken,
  hashCashierPin,
  verifyCashierContextToken,
  verifyCashierPin,
} from "../src/lib/auth/cashier-pin";

describe("cashier PIN security", () => {
  test("stores a salted scrypt hash and verifies without exposing the PIN", () => {
    const encoded = hashCashierPin("482913");

    expect(encoded).not.toContain("482913");
    expect(encoded.startsWith("scrypt$v1$")).toBe(true);
    expect(verifyCashierPin("482913", encoded)).toBe(true);
    expect(verifyCashierPin("482914", encoded)).toBe(false);
  });

  test("rejects malformed PIN hashes", () => {
    expect(verifyCashierPin("482913", "not-a-hash")).toBe(false);
    expect(verifyCashierPin("482913", "")).toBe(false);
  });

  test("cashier context is signed, principal-bound and expires", () => {
    const secret = "a-production-length-test-secret-with-32-bytes";
    const token = createCashierContextToken(
      {
        principalId: "11111111-1111-4111-8111-111111111111",
        cashierId: "22222222-2222-4222-8222-222222222222",
        role: "cashier",
      },
      { secret, nowMs: 1_000, ttlMs: 60_000 },
    );

    expect(
      verifyCashierContextToken(token, {
        secret,
        principalId: "11111111-1111-4111-8111-111111111111",
        nowMs: 30_000,
      })?.cashierId,
    ).toBe("22222222-2222-4222-8222-222222222222");
    expect(
      verifyCashierContextToken(token, {
        secret,
        principalId: "33333333-3333-4333-8333-333333333333",
        nowMs: 30_000,
      }),
    ).toBeNull();
    expect(
      verifyCashierContextToken(token, {
        secret,
        principalId: "11111111-1111-4111-8111-111111111111",
        nowMs: 61_001,
      }),
    ).toBeNull();
    expect(
      verifyCashierContextToken(`${token}tampered`, {
        secret,
        principalId: "11111111-1111-4111-8111-111111111111",
        nowMs: 30_000,
      }),
    ).toBeNull();
  });
});

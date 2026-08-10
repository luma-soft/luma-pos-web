import { describe, expect, test } from "bun:test";
import {
  activeStorePrincipal,
  sameStore,
} from "../src/lib/auth/store-context-policy";

describe("store context policy", () => {
  test("resolves exactly one active profile in an active store", () => {
    expect(activeStorePrincipal({
      userId: "user-a",
      storeId: "store-a",
      role: "manager",
      profileActive: true,
      storeStatus: "active",
    })).toEqual({ userId: "user-a", storeId: "store-a", role: "manager" });
  });

  test("fails closed for inactive profiles and suspended stores", () => {
    expect(activeStorePrincipal({
      userId: "user-a",
      storeId: "store-a",
      role: "owner",
      profileActive: false,
      storeStatus: "active",
    })).toBeNull();
    expect(activeStorePrincipal({
      userId: "user-a",
      storeId: "store-a",
      role: "owner",
      profileActive: true,
      storeStatus: "suspended",
    })).toBeNull();
  });

  test("does not treat two principals from different stores as related", () => {
    expect(sameStore({ storeId: "store-a" }, { storeId: "store-a" })).toBe(true);
    expect(sameStore({ storeId: "store-a" }, { storeId: "store-b" })).toBe(false);
  });
});

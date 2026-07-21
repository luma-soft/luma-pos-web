import { describe, expect, it } from "vitest";
import { canCreateInternalUse } from "@/lib/inventory/internal-use-policy";

describe("internal-use stock authorization", () => {
  it("allows stock operators but never a cashier", () => {
    expect(canCreateInternalUse("owner")).toBe(true);
    expect(canCreateInternalUse("manager")).toBe(true);
    expect(canCreateInternalUse("warehouse")).toBe(true);
    expect(canCreateInternalUse("cashier")).toBe(false);
  });
});

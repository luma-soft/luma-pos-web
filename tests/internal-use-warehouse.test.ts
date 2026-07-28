import { describe, expect, it } from "bun:test";
import { resolveAuthoritativeInternalUseWarehouse } from "@/lib/inventory/internal-use-warehouse";

describe("internal-use authoritative warehouse", () => {
  it("chooses a deterministic warehouse when none is marked default", () => {
    expect(resolveAuthoritativeInternalUseWarehouse([
      { id: "warehouse-z", name: "Warehouse Z", isDefault: false },
      { id: "warehouse-a", name: "Warehouse A", isDefault: false },
    ])).toEqual({ id: "warehouse-a", name: "Warehouse A", isDefault: false });
  });

  it("chooses deterministically when multiple warehouses are marked default", () => {
    expect(resolveAuthoritativeInternalUseWarehouse([
      { id: "default-z", name: "Default Z", isDefault: true },
      { id: "fallback-a", name: "Fallback A", isDefault: false },
      { id: "default-a", name: "Default A", isDefault: true },
    ])).toEqual({ id: "default-a", name: "Default A", isDefault: true });
  });

  it("returns null when there are no warehouses", () => {
    expect(resolveAuthoritativeInternalUseWarehouse([])).toBeNull();
  });
});

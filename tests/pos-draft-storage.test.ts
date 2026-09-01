import { describe, expect, test } from "bun:test";
import {
  LEGACY_POS_ACTIVE_DRAFT_KEY,
  LEGACY_POS_DRAFTS_KEY,
  loadPosDraftSnapshot,
  savePosDraftSnapshot,
} from "@/lib/pos/draft-storage";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("POS draft storage", () => {
  test("persists drafts and the active draft as one recoverable snapshot", () => {
    const scopeId = "store-1:user-1:cashier";
    const drafts = [
      { id: "invoice-1", cart: [{ productId: "product-1", quantity: 1 }] },
      { id: "invoice-2", cart: [{ productId: "product-2", quantity: 2 }] },
    ];
    const storage = new MemoryStorage();

    expect(savePosDraftSnapshot(storage, scopeId, drafts, "invoice-2")).toBe(true);

    const restored = loadPosDraftSnapshot(storage, scopeId);
    expect(restored?.drafts).toEqual(drafts);
    expect(restored?.activeId).toBe("invoice-2");
    expect(restored?.version).toBe(2);
  });

  test("loads the existing separate localStorage keys for compatibility", () => {
    const scopeId = "store-1:user-1:cashier";
    const storage = new MemoryStorage();
    storage.setItem(
      `${LEGACY_POS_DRAFTS_KEY}:${scopeId}`,
      JSON.stringify([{ id: "invoice-legacy", cart: [] }]),
    );
    storage.setItem(
      `${LEGACY_POS_ACTIVE_DRAFT_KEY}:${scopeId}`,
      "invoice-legacy",
    );

    expect(loadPosDraftSnapshot(storage, scopeId)).toMatchObject({
      activeId: "invoice-legacy",
      drafts: [{ id: "invoice-legacy", cart: [] }],
    });
  });

  test("rejects a corrupt snapshot without throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem("pos-draft-state-v2:scope", "{not-json");

    expect(loadPosDraftSnapshot(storage, "scope")).toBeNull();
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { parkPosDraftSnapshot, type PosDraftStorage } from "./draft-storage";

class MemoryStorage implements PosDraftStorage {
  value: string | null = null;
  fail = false;

  getItem() { return this.value; }
  setItem(_key: string, value: string) {
    if (this.fail) throw new Error("quota");
    this.value = value;
  }
}

test("holding a cart persists it and activates a fresh cart", () => {
  const storage = new MemoryStorage();
  const current = { id: "one", cart: [{ productId: "cut-27", quantity: 2 }] };
  const fresh = { id: "two", cart: [] as Array<{ productId: string; quantity: number }> };
  const result = parkPosDraftSnapshot(storage, "shop:user", [current], "one", fresh);

  assert.equal(result?.activeId, "two");
  assert.equal(result?.drafts.length, 2);
  assert.deepEqual(result?.drafts[0]?.cart, current.cart);
  assert.equal(typeof result?.drafts[0]?.heldAt, "string");
  assert.deepEqual(result?.drafts[1], fresh);
  assert.equal(JSON.parse(storage.value!).activeId, "two");
});

test("storage failure leaves the current cart on screen", () => {
  const storage = new MemoryStorage();
  storage.fail = true;
  const result = parkPosDraftSnapshot(
    storage,
    "shop:user",
    [{ id: "one", cart: [{ productId: "cut-27" }] }],
    "one",
    { id: "two", cart: [] },
  );

  assert.equal(result, null);
});

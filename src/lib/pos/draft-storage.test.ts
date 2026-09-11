import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPosDraftSnapshot,
  parkPosDraftSnapshot,
  reconcilePosDraftTaxDefaults,
  savePosDraftSnapshot,
  type PosDraftStorage,
} from "./draft-storage";

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

test("disabled automatic VAT clears a legacy unsaved draft", () => {
  const drafts = reconcilePosDraftTaxDefaults(
    [{ id: "legacy", taxRate: 10, cart: [{ productId: "one" }] }],
    { currentDefaultRate: 0 },
  );

  assert.equal(drafts[0]?.taxRate, 0);
});

test("tax reconciliation updates defaults but preserves manual and source rates", () => {
  const drafts = reconcilePosDraftTaxDefaults(
    [
      { id: "default", taxRate: 10, cart: [] },
      { id: "manual", taxRate: 8, cart: [] },
      { id: "source", taxRate: 10, source: { orderId: "saved" }, cart: [] },
    ],
    { previousDefaultRate: 10, currentDefaultRate: 0 },
  );

  assert.deepEqual(drafts.map((draft) => draft.taxRate), [0, 8, 10]);
});

test("snapshot persists the tax default used by its drafts", () => {
  const storage = new MemoryStorage();
  assert.equal(
    savePosDraftSnapshot(storage, "shop:user", [{ id: "one" }], "one", {
      taxDefaultRate: 8,
    }),
    true,
  );

  const loaded = loadPosDraftSnapshot(storage, "shop:user");
  assert.equal(loaded?.taxDefaultRate, 8);
});

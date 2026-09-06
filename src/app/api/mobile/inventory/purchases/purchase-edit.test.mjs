import { beforeEach, expect, mock, test } from "bun:test";
let gate;
const update = mock(async () => ({ ok: true, data: { updatedAt: "2026-09-06" } }));
const saveDraft = mock(async () => ({ ok: true, data: { id: "draft" } }));
mock.module("@/lib/actions/purchases", () => ({ updatePurchase: update, savePurchaseDraft: saveDraft }));
mock.module("@/lib/data/inventory", () => ({ getPurchase: async () => null }));
mock.module("@/lib/mobile/auth", () => ({ requireMobileStockAccess: async () => gate }));
const { PATCH } = await import("./[id]/route");
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const request = body => new Request("http://localhost/api/mobile/inventory/purchases/" + id,
  { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
beforeEach(() => { gate = { ok: true, storeId: "store" }; update.mockClear(); saveDraft.mockClear(); });
test("denies unauthorized mutation before invoking purchase action", async () => {
  gate = { ok: false, error: "errors.forbidden" };
  expect((await PATCH(request({}), context)).status).toBe(403);
  expect(update).not.toHaveBeenCalled();
});
test("path id is authoritative and fractional items reach shared action unchanged", async () => {
  const items = [{ productId: id, quantity: 0.5, unitCost: 10000, discount: 0 }];
  expect((await PATCH(request({ id: "other", items }), context)).status).toBe(200);
  expect(update).toHaveBeenCalledWith({ id, items });
});
test("rejects invalid identifiers and non-object payloads", async () => {
  expect((await PATCH(request({}), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(404);
  expect((await PATCH(request([]), context)).status).toBe(400);
  expect(update).not.toHaveBeenCalled();
});

test("draft intent dispatches only draft persistence with authoritative path id", async () => {
  const items = [{ productId: id, quantity: 0.5, unitCost: 10000, discount: 0 }];
  expect((await PATCH(request({ id: "other", intent: "draft", items }), context)).status).toBe(200);
  expect(saveDraft).toHaveBeenCalledWith({ id, intent: "draft", items });
  expect(update).not.toHaveBeenCalled();
});
test("unknown intent cannot accidentally receive stock", async () => {
  expect((await PATCH(request({ intent: "drafft" }), context)).status).toBe(400);
  expect(update).not.toHaveBeenCalled();
  expect(saveDraft).not.toHaveBeenCalled();
});

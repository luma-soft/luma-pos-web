import { beforeEach, expect, mock, test } from "bun:test";
let gate;
const draft = mock(async () => ({ ok: true, data: { id: "draft" } }));
const receive = mock(async () => ({ ok: true, data: { id: "received" } }));
const select = mock(() => { throw new Error("Unexpected fallback lookup"); });
mock.module("@/db", () => ({ db: { select } }));
mock.module("@/lib/actions/purchases", () => ({ savePurchaseDraft: draft, createPurchase: receive }));
mock.module("@/lib/mobile/auth", () => ({ requireMobileStockAccess: async () => gate }));
const { POST } = await import("./route");
const request = body => new Request("http://localhost/api/mobile/inventory/inbound", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});
beforeEach(() => { gate = { ok: true, storeId: "store" }; draft.mockClear(); receive.mockClear(); select.mockClear(); });
test("new draft intent cannot reuse payload id or fall through to receiving", async () => {
  const items = [{ productId: "product", quantity: 0.5, unitCost: 0 }];
  expect((await POST(request({ intent: "draft", id: "other", items }))).status).toBe(200);
  expect(draft).toHaveBeenCalledWith({ intent: "draft", id: undefined, items });
  expect(receive).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});
test("denied or malformed requests cannot mutate", async () => {
  gate = { ok: false, error: "errors.forbidden" };
  expect((await POST(request({ intent: "draft" }))).status).toBe(403);
  gate = { ok: true };
  expect((await POST(request([]))).status).toBe(400);
  expect((await POST(request({ intent: "drafft" }))).status).toBe(400);
  expect(draft).not.toHaveBeenCalled();
  expect(receive).not.toHaveBeenCalled();
});

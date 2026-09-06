import { beforeEach, expect, mock, test } from "bun:test";
let gate, detail;
const update = mock(async () => ({ ok: true }));
const cancel = mock(async () => ({ ok: true }));
mock.module("@/lib/actions/returns", () => ({ updateReturnMetadata: update, cancelReturn: cancel }));
mock.module("@/lib/data/returns", () => ({ getReturn: async () => detail }));
mock.module("@/lib/mobile/auth", () => ({ requireMobileManager: async () => gate, requireMobileSalesAccess: async () => gate }));
const { GET, PATCH } = await import("./[id]/route");
const { POST } = await import("./[id]/cancel/route");
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const request = body => new Request("http://localhost/api/mobile/returns/" + id, { method: "PATCH", body: JSON.stringify(body) });
beforeEach(() => { gate = { ok: true, role: "manager", storeId: "store" }; detail = { status: "completed" }; update.mockClear(); cancel.mockClear(); });
test("mutations reject permission failure before shared business actions", async () => {
  gate = { ok: false, error: "errors.forbidden" };
  expect((await PATCH(request({}), context)).status).toBe(403);
  expect((await POST(request({}), context)).status).toBe(403);
  expect(update).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
test("metadata routes only to the path return, cancellation delegates to shared action", async () => {
  const body = { reason: "wrong_item", note: "Corrected note" };
  expect((await PATCH(request(body), context)).status).toBe(200);
  expect(update).toHaveBeenCalledWith(id, body);
  expect((await POST(request({}), context)).status).toBe(200);
  expect(cancel).toHaveBeenCalledWith(id);
});
test("rejects bad ids and invalid metadata bodies", async () => {
  const invalid = { params: Promise.resolve({ id: "bad" }) };
  expect((await PATCH(request({}), invalid)).status).toBe(404);
  expect((await POST(request({}), invalid)).status).toBe(404);
  expect((await PATCH(request([]), context)).status).toBe(400);
  expect(update).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
test("capabilities reflect manager, cancelled and exchange restrictions", async () => {
  for (const [role, status, exchangeOrderId, canEdit, canCancel] of [
    ["manager", "completed", null, true, true],
    ["cashier", "completed", null, false, false],
    ["owner", "cancelled", null, false, false],
    ["owner", "completed", "exchange", true, false],
  ]) {
    gate.role = role; detail = { status, exchangeOrderId };
    const json = await (await GET(request({}), context)).json();
    expect(json.data.canEdit).toBe(canEdit); expect(json.data.canCancel).toBe(canCancel);
  }
});

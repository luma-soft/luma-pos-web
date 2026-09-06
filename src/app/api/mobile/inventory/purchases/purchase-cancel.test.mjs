import { beforeEach, expect, mock, test } from "bun:test";
let gate;
const cancel = mock(async () => ({ok: true, data: null}));
mock.module("@/lib/actions/purchases", () => ({cancelPurchase: cancel}));
mock.module("@/lib/mobile/auth", () => ({requireMobileManager: async () => gate}));
const {POST} = await import("./[id]/cancel/route");
const id = "11111111-1111-4111-8111-111111111111";
const req = new Request("http://localhost/api/mobile/inventory/purchases/"+id+"/cancel", {method:"POST"});
beforeEach(() => {gate = {ok:true, storeId:"store", role:"manager"}; cancel.mockReset(); cancel.mockResolvedValue({ok:true,data:null});});
test("cancellation denies warehouse/cashier before shared manager action", async () => {
 gate = {ok:false,error:"errors.forbidden"};
 expect((await POST(req,{params:Promise.resolve({id})})).status).toBe(403);
 expect(cancel).not.toHaveBeenCalled();
});
test("valid cancellation uses the route id and shared business action", async () => {
 expect((await POST(req,{params:Promise.resolve({id})})).status).toBe(200);
 expect(cancel).toHaveBeenCalledWith(id);
});
test("invalid id cannot reach cancellation and business constraints surface", async () => {
 expect((await POST(req,{params:Promise.resolve({id:"invalid"})})).status).toBe(404);
 expect(cancel).not.toHaveBeenCalled();
 cancel.mockResolvedValue({ok:false,error:"purchases.errors.batchAlreadyConsumed"});
 const result=await POST(req,{params:Promise.resolve({id})});
 expect((await result.json()).error).toBe("purchases.errors.batchAlreadyConsumed");
});

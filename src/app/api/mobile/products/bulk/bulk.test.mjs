import { beforeEach, expect, mock, test } from "bun:test";
let gate;
const stop = mock(async () => ({ok:true,data:{updated:2}}));
const remove = mock(async () => ({ok:true,data:{deleted:1,failedIds:["22222222-2222-4222-8222-222222222222"]}}));
mock.module("@/lib/mobile/auth",()=>({requireMobileStockAccess:async()=>gate}));
mock.module("@/lib/actions/products",()=>({bulkDeleteProducts:remove,bulkStopSellingProducts:stop}));
const {POST}=await import("./route");
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
const req=body=>new Request("http://localhost/api/mobile/products/bulk",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{gate={ok:true,storeId:"store",role:"owner"};stop.mockClear();remove.mockClear();});
test("bulk delegates exact IDs and preserves partial-delete result",async()=>{
 const response=await POST(req({action:"delete",ids}));
 expect((await response.json()).data).toEqual({deleted:1,failedIds:[ids[1]]});expect(remove).toHaveBeenCalledWith(ids);
 expect((await POST(req({action:"stop",ids}))).status).toBe(200);expect(stop).toHaveBeenCalledWith(ids);
});
test("rejects unauthorized, oversized and invalid batches before mutation",async()=>{
 gate={ok:false,error:"errors.forbidden"};expect((await POST(req({action:"delete",ids}))).status).toBe(403);
 gate={ok:true,role:"owner"};
 for(const body of [{action:"unknown",ids},{action:"delete",ids:[]},{action:"stop",ids:["bad"]},{action:"delete",ids:Array(101).fill(ids[0])}]) expect((await POST(req(body))).status).toBe(400);
 expect(stop).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});

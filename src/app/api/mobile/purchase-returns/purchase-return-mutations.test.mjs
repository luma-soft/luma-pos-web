import { beforeEach, expect, mock, test } from "bun:test";
let gate;
const update = mock(async () => ({ ok:true,data:{id:"saved"} }));
const remove = mock(async () => ({ ok:true,data:undefined }));
mock.module("@/lib/actions/purchase-returns",()=>({updatePurchaseReturn:update,deletePurchaseReturn:remove}));
mock.module("@/lib/data/purchase-returns",()=>({getPurchaseReturn:async()=>null}));
mock.module("@/lib/mobile/auth",()=>({requireMobileManager:async()=>gate,requireMobileStockReadAccess:async()=>gate}));
const {PATCH,DELETE}=await import("./[id]/route");
const id="11111111-1111-4111-8111-111111111111";
const context={params:Promise.resolve({id})};
const req=body=>new Request("http://localhost/api/mobile/purchase-returns/"+id,{method:"PATCH",body:JSON.stringify(body)});
beforeEach(()=>{gate={ok:true,storeId:"store",role:"owner"};update.mockClear();remove.mockClear();});
test("permissions precede mutations",async()=>{
 gate={ok:false,error:"errors.forbidden"};
 expect((await PATCH(req({}),context)).status).toBe(403);
 expect((await DELETE(req({}),context)).status).toBe(403);
 expect(update).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
test("path identity is authoritative and errors are rejected",async()=>{
 const body={id:"different",items:[]};
 expect((await PATCH(req(body),context)).status).toBe(200);expect(update).toHaveBeenCalledWith(id,body);
 expect((await DELETE(req({}),context)).status).toBe(200);expect(remove).toHaveBeenCalledWith(id);
 const bad={params:Promise.resolve({id:"bad"})};
 expect((await PATCH(req({}),bad)).status).toBe(404);
 expect((await DELETE(req({}),bad)).status).toBe(404);
 expect((await PATCH(req([]),context)).status).toBe(400);
});

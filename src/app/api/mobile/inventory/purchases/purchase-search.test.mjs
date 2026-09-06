import {mock,test,expect} from "bun:test";
let allowed=true;
const read=mock(async()=>({rows:[{id:"older-than-first-30"}],total:61,pageCount:3}));
mock.module("@/lib/mobile/auth",()=>({requireMobileStockReadAccess:async()=>allowed?{ok:true,storeId:"own-store"}:{ok:false,error:"errors.forbidden",status:403}}));
mock.module("@/lib/data/inventory",()=>({getPurchases:read}));
const {GET}=await import("./route");
test("search and pagination reach shared query within authenticated store",async()=>{
 const res=await GET(new Request("http://localhost/api/mobile/inventory/purchases?q=OLD&page=2&status=draft&supplierId=s&from=2026-01-01&to=2026-08-01&debtOnly=1&storeId=other"));
 expect(res.status).toBe(200);
 expect(read).toHaveBeenCalledWith("own-store",{q:"OLD",page:2,pageSize:30,status:"draft",supplierId:"s",from:"2026-01-01",to:"2026-08-01",debtOnly:true});
 expect(await res.json()).toMatchObject({data:{pageCount:3}});
});
test("unauthorized search never reads records",async()=>{allowed=false;read.mockClear();await GET(new Request("http://localhost/api/mobile/inventory/purchases"));expect(read).not.toHaveBeenCalled();});

import { getPurchases } from "@/lib/data/inventory";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;
  const page = Math.max(1, Math.floor(numberParam(request, "page", 1)));
  return mobileOk(await getPurchases(gate.storeId, {
    q: searchParam(request, "q"), status: searchParam(request, "status"),
    supplierId: searchParam(request, "supplierId"),
    from: searchParam(request, "from"), to: searchParam(request, "to"),
    debtOnly: searchParam(request, "debtOnly") === "1", page, pageSize: 30,
  }));
}

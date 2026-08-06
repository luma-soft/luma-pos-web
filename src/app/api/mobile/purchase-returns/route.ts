import { createPurchaseReturn } from "@/lib/actions/purchase-returns";
import {
  getPurchaseReturnFormOptions,
  getPurchaseReturns,
} from "@/lib/data/purchase-returns";
import {
  requireMobileStockAccess,
  requireMobileStockReadAccess,
} from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const [purchaseReturns, options] = await Promise.all([
    getPurchaseReturns({
      q: searchParam(request, "q"),
      status: searchParam(request, "status"),
      settlement: searchParam(request, "settlement"),
      supplierId: searchParam(request, "supplierId"),
      warehouseId: searchParam(request, "warehouseId"),
      from: searchParam(request, "from"),
      to: searchParam(request, "to"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 30),
    }),
    getPurchaseReturnFormOptions(),
  ]);

  return mobileOk({ purchaseReturns, options });
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(
    await createPurchaseReturn(
      body as Parameters<typeof createPurchaseReturn>[0],
    ),
  );
}

import { productDisplayName } from "@/lib/products/variant-presentation";
import { searchPurchaseReturnProducts } from "@/lib/actions/purchase-returns";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const warehouseId = searchParam(request, "warehouseId");
  const q = searchParam(request, "q");
  if (!warehouseId || !q) return mobileOk([]);

  return mobileOk((await searchPurchaseReturnProducts(q, warehouseId)).map((product) => ({ ...product, name: productDisplayName(product) })));
}

import { getInventory, getPurchaseFormOptions, getPurchases, getRecentMovements } from "@/lib/data/inventory";
import type { StockFilter } from "@/lib/data/inventory";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const [inventory, movements, purchases, purchaseOptions] = await Promise.all([
    getInventory({
      q: searchParam(request, "q"),
      stock: searchParam(request, "stock") as StockFilter | undefined,
      categoryId: searchParam(request, "categoryId"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 50),
    }),
    getRecentMovements(30),
    getPurchases({ pageSize: 10 }),
    getPurchaseFormOptions(),
  ]);

  return mobileOk({ inventory, movements, purchases, purchaseOptions });
}

import {
  getInventory,
  getInternalUseCostSummary,
  getPurchaseFormOptions,
  getPurchases,
  getRecentMovements,
} from "@/lib/data/inventory";
import { getExpiryStockAlerts } from "@/lib/data/inventory-lots";
import { getInternalUseIssues } from "@/lib/data/internal-use";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import {
  mobileError,
  mobileGate,
  mobileOk,
  numberParam,
  searchParam,
} from "@/lib/mobile/response";
import { withTimeout } from "@/lib/mobile/timeout";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  try {
    const products = await withTimeout(
      getInventory({
        q: searchParam(request, "q"),
        categoryId: searchParam(request, "categoryId"),
        page: numberParam(request, "page", 1),
        pageSize: numberParam(request, "pageSize", 15),
      }),
      4000,
    );

    const [movements, purchases, purchaseOptions, expiry, internalUse, internalUseIssues] =
      await Promise.all([
        withTimeout(getRecentMovements(15), 4000),
        withTimeout(getPurchases({ pageSize: 30 }), 4000),
        withTimeout(getPurchaseFormOptions(), 4000),
        withTimeout(getExpiryStockAlerts(30, 50), 4000),
        withTimeout(getInternalUseCostSummary(), 4000),
        withTimeout(getInternalUseIssues({ limit: 50 }), 4000),
      ]);

    return mobileOk({
      inventory: products,
      movements,
      purchases,
      purchaseOptions,
      expiry,
      internalUse,
      internalUseIssues,
    });
  } catch {
    return mobileError("errors.serverError", 503);
  }
}

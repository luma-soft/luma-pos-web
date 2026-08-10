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
  if (!gate.ok) return mobileGate(gate)!;

  try {
    const products = await withTimeout(
      getInventory(gate.storeId, {
        q: searchParam(request, "q"),
        categoryId: searchParam(request, "categoryId"),
        warehouseId: searchParam(request, "warehouseId"),
        stock: (searchParam(request, "stock") as "all" | "instock" | "low" | "out" | undefined) ?? "all",
        page: numberParam(request, "page", 1),
        pageSize: numberParam(request, "pageSize", 15),
      }),
      4000,
    );

    const [movements, purchases, purchaseOptions, expiry, internalUse, internalUseIssues] =
      await Promise.all([
        withTimeout(getRecentMovements(gate.storeId, 15), 4000),
        withTimeout(getPurchases(gate.storeId, { q: searchParam(request, "purchaseQ"), status: searchParam(request, "purchaseStatus") ?? undefined, supplierId: searchParam(request, "supplierId") ?? undefined, warehouseId: searchParam(request, "purchaseWarehouseId") ?? undefined, from: searchParam(request, "from") ?? undefined, to: searchParam(request, "to") ?? undefined, debtOnly: searchParam(request, "debtOnly") === "1", pageSize: 30 }), 4000),
        withTimeout(getPurchaseFormOptions(gate.storeId), 4000),
        withTimeout(getExpiryStockAlerts(gate.storeId, 30, 50), 4000),
        withTimeout(getInternalUseCostSummary(gate.storeId), 4000),
        withTimeout(getInternalUseIssues(gate.storeId, { limit: 50 }), 4000),
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

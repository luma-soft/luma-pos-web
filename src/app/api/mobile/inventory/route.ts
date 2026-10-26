import { productDisplayName, productLineDisplayName } from "@/lib/products/variant-presentation";
import {
  getInventory,
  getInventoryOverview,
  getInternalUseCostSummary,
  getPurchaseFormOptions,
  getPurchases,
  getRecentMovements,
  type StockFilter,
} from "@/lib/data/inventory";
import { getPricingCategories } from "@/lib/data/pricing";
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
    const requestedStock = searchParam(request, "stock") ?? "all";
    const supportedStockFilters: StockFilter[] = [
      "all", "negativeStock", "outOfStock", "lowStock", "inStock", "available",
      "instock", "low", "out",
    ];
    const stock = supportedStockFilters.includes(requestedStock as StockFilter)
      ? requestedStock as StockFilter
      : "all";
    const products = await withTimeout(
      getInventory(gate.storeId, {
        q: searchParam(request, "q"),
        categoryId: searchParam(request, "categoryId"),
        warehouseId: searchParam(request, "warehouseId"),
        stock,
        page: numberParam(request, "page", 1),
        pageSize: numberParam(request, "pageSize", 15),
      }),
      4000,
    );

    if (stock !== "all") {
      const categories = await withTimeout(getPricingCategories(gate.storeId), 4000);
      return mobileOk({
        inventory: { ...products, rows: products.rows.map((row) => ({ ...row, name: productDisplayName(row) })) },
        categories,
      });
    }

    const [movements, purchases, purchaseOptions, expiry, internalUse, internalUseIssues, overview] =
      await Promise.all([
        withTimeout(getRecentMovements(gate.storeId, 100), 4000),
        withTimeout(getPurchases(gate.storeId, { q: searchParam(request, "purchaseQ"), status: searchParam(request, "purchaseStatus") ?? undefined, supplierId: searchParam(request, "supplierId") ?? undefined, warehouseId: searchParam(request, "purchaseWarehouseId") ?? undefined, from: searchParam(request, "from") ?? undefined, to: searchParam(request, "to") ?? undefined, debtOnly: searchParam(request, "debtOnly") === "1", pageSize: 30 }), 4000),
        withTimeout(getPurchaseFormOptions(gate.storeId), 4000),
        withTimeout(getExpiryStockAlerts(gate.storeId, 30, 50), 4000),
        withTimeout(getInternalUseCostSummary(gate.storeId), 4000),
        withTimeout(getInternalUseIssues(gate.storeId, { limit: 50 }), 4000),
        withTimeout(getInventoryOverview(gate.storeId), 4000),
      ]);

    return mobileOk({
      inventory: { ...products, rows: products.rows.map((row) => ({ ...row, name: productDisplayName(row) })) },
      overview,
      movements: movements.map((row) => ({ ...row, productName: productLineDisplayName(row) })),
      purchases: { ...purchases, rows: purchases.rows.map((row) => ({ ...row, items: row.items.map((item) => ({ ...item, productName: productLineDisplayName(item) })) })) },
      purchaseOptions,
      expiry,
      internalUse,
      internalUseIssues: internalUseIssues.map((row) => ({ ...row, items: row.items.map((item) => ({ ...item, productName: productLineDisplayName(item) })) })),
    });
  } catch {
    return mobileError("errors.serverError", 503);
  }
}

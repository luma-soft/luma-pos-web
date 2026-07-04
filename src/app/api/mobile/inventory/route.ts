import { getMobileProducts } from "@/lib/data/products";
import { getPurchaseFormOptions, getPurchases, getRecentMovements } from "@/lib/data/inventory";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

async function withFallback<T>(promise: Promise<T>, fallback: T, timeoutMs = 4000): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const products = await getMobileProducts({
      q: searchParam(request, "q"),
      categoryId: searchParam(request, "categoryId"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 15),
    });

  const [movements, purchases, purchaseOptions] = await Promise.all([
    withFallback(getRecentMovements(15), []),
    withFallback(getPurchases({ pageSize: 5 }), { rows: [], total: 0, page: 1, pageSize: 5, pageCount: 1 }),
    withFallback(getPurchaseFormOptions(), { suppliers: [], warehouses: [] }),
  ]);

  const inventory = {
    ...products,
    rows: products.rows.map((row) => ({
      ...row,
      stockValue: `${Number(row.totalStock ?? 0) * Number(row.costPrice ?? 0)}`,
    })),
    totalValue: 0,
    lowCount: 0,
  };

  return mobileOk({ inventory, movements, purchases, purchaseOptions });
}

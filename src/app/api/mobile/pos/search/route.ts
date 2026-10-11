import { searchPosProductRows } from "@/lib/data/pos";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { parsePriceComparisonParams } from "@/lib/pricing/price-comparison";

export async function GET(request: Request) {
  const gate = await requireMobileSalesAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const query = searchParam(request, "q", "") ?? "";
  const params = new URL(request.url).searchParams;
  const csv = (key: string) => (params.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const priceComparison = canViewPurchasePrices(gate.role)
    ? parsePriceComparisonParams(params)
    : {};
  return mobileOk(await searchPosProductRows(gate.storeId, query, {
    role: gate.role,
    priceComparison,
    categoryNames: csv("category"),
    stock: (params.get("stock") as "all" | "available" | "outOfStock" | null) ?? "all",
    productKind: (params.get("productKind") as "all" | "product" | "service" | "combo" | null) ?? "all",
  }));
}

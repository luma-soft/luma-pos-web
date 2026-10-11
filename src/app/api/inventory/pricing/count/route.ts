import { NextResponse } from "next/server";
import { requireStockAccess } from "@/lib/actions/common";
import { getPricingPage } from "@/lib/data/pricing";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { parsePriceComparisonParams } from "@/lib/pricing/price-comparison";

const split = (value: string | null) => value
  ? value.split(",").map((item) => item.trim()).filter(Boolean)
  : undefined;

export async function GET(request: Request) {
  const gate = await requireStockAccess();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: gate.error === "errors.forbidden" ? 403 : 401 },
    );
  }

  const params = new URL(request.url).searchParams;
  const priceComparison = canViewPurchasePrices(gate.role)
    ? parsePriceComparisonParams(params)
    : {};
  const stockAlias = params.get("stock");
  const stock = stockAlias === "instock"
    ? "available"
    : stockAlias === "low"
      ? "lowStock"
      : stockAlias === "out"
        ? "outOfStock"
        : stockAlias ?? undefined;
  const status = params.get("status");
  const lifecycle = status === "inactive" ? "paused" : status || "active";
  const result = await getPricingPage(gate.storeId, {
    q: params.get("q") ?? undefined,
    categoryIds: split(params.get("categoryId")),
    brandIds: split(params.get("brandId")),
    supplierIds: split(params.get("supplierId")),
    productKind: params.get("productKind") ?? undefined,
    stock,
    lifecycle,
    warehouseId: params.get("warehouseId") ?? undefined,
    ...priceComparison,
    page: 1,
    pageSize: 1,
  });
  return NextResponse.json(
    { ok: true, data: { total: result.total } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

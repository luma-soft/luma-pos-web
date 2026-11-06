import { Suspense } from "react";
import { getPriceBooks } from "@/lib/data/price-books";
import { TableSkeleton } from "@/components/table-skeleton";
import { requireStoreContext } from "@/lib/auth/store-context";
import { canViewPurchasePrices, comparePriceBooks } from "@/lib/pricing/system-price-books";
import { priceFormulaFiltersSchema } from "@/lib/pricing/price-edit";
import { parsePriceComparisonParams } from "@/lib/pricing/price-comparison";
import { PricingCatalogContent } from "./pricing-catalog-content";

type SP = Record<string, string | undefined>;

/** Inventory URL aliases remain the same predicate for listing and bulk edits. */
export function inventoryPricingFilters(params: SP) {
  const ids = (value?: string) => value ? value.split(",").map((id) => id.trim()).filter(Boolean) : undefined;
  const stock = params.stock ? ({ instock: "available", low: "lowStock", out: "outOfStock" }[params.stock] ?? params.stock) : undefined;
  const lifecycle = params.lifecycle || (params.status === "inactive" ? "paused" : params.status) || "active";
  return priceFormulaFiltersSchema.parse({
    q: params.q, categoryIds: ids(params.categoryIds ?? params.category),
    brandIds: ids(params.brandIds ?? params.brandId), supplierIds: ids(params.supplierIds ?? params.supplierId),
    productKind: params.productKind || undefined, stock, lifecycle, warehouseId: params.warehouseId || undefined,
    ...parsePriceComparisonParams(params),
  });
}

export async function PricingTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const canSeePurchasePrices = canViewPurchasePrices(context.role);
  const [books] = await Promise.all([
    getPriceBooks(context.storeId, { includeManagerOnly: canSeePurchasePrices }),
  ]);
  const requestedFilters = inventoryPricingFilters(searchParams);
  const formulaFilters = canSeePurchasePrices
    ? requestedFilters
    : { ...requestedFilters, priceCondition: undefined, priceAgainst: undefined };

  return (
    <Suspense fallback={<TableSkeleton cols={4} rows={10} />}>
      <PricingCatalogContent
        books={[...books].sort(comparePriceBooks)}
        searchParams={searchParams}
        formulaFilters={formulaFilters}
        canViewPurchasePrices={canSeePurchasePrices}
        canEditCostPrice={canSeePurchasePrices}
      />
    </Suspense>
  );
}

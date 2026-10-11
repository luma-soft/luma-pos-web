import {
  getPricingBrands,
  getPricingCategories,
  getPricingPage,
  getPricingSuppliers,
} from "@/lib/data/pricing";
import { parsePricingSort } from "@/lib/pricing/pricing-policy";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { parsePriceComparisonParams } from "@/lib/pricing/price-comparison";
import { getPriceBooks } from "@/lib/data/price-books";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import {
  mobileGate,
  mobileOk,
  numberParam,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const includePurchasePrices = canViewPurchasePrices(gate.role);
  const params = new URL(request.url).searchParams;
  const requestedComparison = parsePriceComparisonParams(params);
  const requestedBookId = params.get("priceBookId");
  const books = requestedBookId
    ? await getPriceBooks(gate.storeId, { includeManagerOnly: includePurchasePrices })
    : [];
  const visiblePriceBookId = books.some((book) => book.id === requestedBookId)
    ? requestedBookId ?? undefined
    : undefined;
  const priceComparison = includePurchasePrices
    ? { ...requestedComparison, priceBookId: visiblePriceBookId }
    : {};

  const [categories, brands, suppliers, products] = await Promise.all([
    getPricingCategories(gate.storeId),
    getPricingBrands(gate.storeId),
    getPricingSuppliers(gate.storeId),
    getPricingPage(gate.storeId, {
      q: searchParam(request, "q"),
      categoryIds: csvParam(request, "categoryIds"),
      brandIds: csvParam(request, "brandIds"),
      supplierIds: csvParam(request, "supplierIds"),
      stock: searchParam(request, "stock"),
      productKind: searchParam(request, "productKind"),
      lifecycle: searchParam(request, "lifecycle", "active"),
      ...priceComparison,
      sort: parsePricingSort(searchParam(request, "sort")),
      warehouseId: searchParam(request, "warehouseId"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 30),
    }),
  ]);

  return mobileOk({
    rows: products.rows.map((product) => ({
      ...product,
      lastPurchaseNetPrice: includePurchasePrices ? product.lastPurchaseNetPrice : null,
      imageUrl: product.imageUrls[0] ?? null,
    })),
    categories,
    brands,
    suppliers,
    total: products.total,
    page: products.page,
    pageSize: products.pageSize,
    pageCount: products.pageCount,
    canCompareSellingPrice: includePurchasePrices,
  });
}

function csvParam(request: Request, key: string): string[] | undefined {
  const value = searchParam(request, key);
  if (!value) return undefined;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

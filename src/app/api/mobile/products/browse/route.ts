import {
  getPricingBrands,
  getPricingCategories,
  getPricingPage,
  getPricingSuppliers,
} from "@/lib/data/pricing";
import { parsePricingSort } from "@/lib/pricing/pricing-policy";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import {
  mobileGate,
  mobileOk,
  numberParam,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const [categories, brands, suppliers, products] = await Promise.all([
    getPricingCategories(),
    getPricingBrands(),
    getPricingSuppliers(),
    getPricingPage({
      q: searchParam(request, "q"),
      categoryIds: csvParam(request, "categoryIds"),
      brandIds: csvParam(request, "brandIds"),
      supplierIds: csvParam(request, "supplierIds"),
      stock: searchParam(request, "stock"),
      productKind: searchParam(request, "productKind"),
      lifecycle: searchParam(request, "lifecycle", "active"),
      sort: parsePricingSort(searchParam(request, "sort")),
      warehouseId: searchParam(request, "warehouseId"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 30),
    }),
  ]);

  return mobileOk({
    rows: products.rows.map((product) => ({
      ...product,
      imageUrl: product.imageUrls[0] ?? null,
    })),
    categories,
    brands,
    suppliers,
    total: products.total,
    page: products.page,
    pageSize: products.pageSize,
    pageCount: products.pageCount,
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

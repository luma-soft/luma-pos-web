import {
  getPricingCategories,
  getPricingBrands,
  getPricingPage,
  getPricingSuppliers,
} from "@/lib/data/pricing";
import { parsePricingSort } from "@/lib/pricing/pricing-policy";
import {
  getPriceBooks,
  getPriceOverridesForProducts,
} from "@/lib/data/price-books";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import {
  mobileGate,
  mobileOk,
  numberParam,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const page = numberParam(request, "page", 1);
  const pageSize = numberParam(request, "pageSize", 50);
  const sort = parsePricingSort(searchParam(request, "sort"));
  const priceBookId = searchParam(request, "priceBookId");
  const [books, categories, brands, suppliers, products] = await Promise.all([
    getPriceBooks(gate.storeId),
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
      sort,
      priceBookId: sort === "retail" ? priceBookId : undefined,
      page,
      pageSize,
    }),
  ]);
  const ids = products.rows.map((product) => product.id);
  const overrides = await getPriceOverridesForProducts(gate.storeId, ids);
  const rows = products.rows.map((product) => ({
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    imageUrl: product.imageUrls[0] ?? null,
    imageUrls: product.imageUrls,
    imageUpdatedAt: product.imageUpdatedAt,
    parentProductId: product.parentProductId,
    variantName: product.variantName,
    isVariantParent: product.isVariantParent,
    baseRetailPrice: product.baseRetailPrice,
    costPrice: product.costPrice,
    lastPurchasePrice: product.lastPurchasePrice,
    overridesByBookId: Object.fromEntries(
      books
        .filter((book) => !book.isDefault)
        .flatMap((book) => {
          const override = overrides[book.id]?.[product.id];
          return override == null ? [] : [[book.id, Number(override)]];
        }),
    ),
  }));

  return mobileOk({
    books,
    categories,
    brands,
    suppliers,
    rows,
    total: products.total,
    page: products.page,
    pageSize: products.pageSize,
    pageCount: products.pageCount,
  });
}

function csvParam(request: Request, key: string): string[] | undefined {
  const value = searchParam(request, key);
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

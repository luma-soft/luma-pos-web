import {
  getPricingCategories,
  getPricingPage,
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
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const page = numberParam(request, "page", 1);
  const pageSize = numberParam(request, "pageSize", 50);
  const sort = parsePricingSort(searchParam(request, "sort"));
  const priceBookId = searchParam(request, "priceBookId");
  const [books, categories, products] = await Promise.all([
    getPriceBooks(),
    getPricingCategories(),
    getPricingPage({
      q: searchParam(request, "q"),
      categoryId: searchParam(request, "categoryId"),
      sort,
      priceBookId: sort === "price" ? priceBookId : undefined,
      page,
      pageSize,
    }),
  ]);
  const ids = products.rows.map((product) => product.id);
  const overrides = await getPriceOverridesForProducts(ids);
  const rows = products.rows.map((product) => ({
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    imageUrl: product.imageUrls[0] ?? null,
    imageUrls: product.imageUrls,
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
    rows,
    total: products.total,
    page: products.page,
    pageSize: products.pageSize,
    pageCount: products.pageCount,
  });
}

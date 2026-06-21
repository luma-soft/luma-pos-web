import { getProducts } from "@/lib/data/products";
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

  const [books, products] = await Promise.all([
    getPriceBooks(),
    getProducts({
      q: searchParam(request, "q"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 50),
    }),
  ]);
  const ids = products.rows.map((product) => product.id);
  const overrides = await getPriceOverridesForProducts(ids);
  const rows = products.rows.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    baseUnit: product.baseUnit,
    costPrice: Number(product.costPrice),
    lastPurchasePrice:
      product.lastPurchasePrice != null
        ? Number(product.lastPurchasePrice)
        : Number(product.costPrice),
    prices: Object.fromEntries(
      books.map((book) => {
        if (book.isDefault) return [book.id, Number(product.retailPrice)];
        const override = overrides[book.id]?.[product.id];
        return [book.id, override != null ? Number(override) : null];
      }),
    ),
  }));

  return mobileOk({
    books,
    rows,
    total: products.total,
    page: products.page,
    pageCount: products.pageCount,
  });
}

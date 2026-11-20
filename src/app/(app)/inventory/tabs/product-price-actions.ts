"use server";

import { requireStoreContext } from "@/lib/auth/store-context";
import { getPricingPage } from "@/lib/data/pricing";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { canViewPurchasePrices, resolvePriceBookPrice } from "@/lib/pricing/system-price-books";

export type ProductPriceBookRow = { id: string; name: string; price: number | null };

/**
 * One product's price in every price book the caller may see, in book order
 * (the iOS product detail "Đơn vị & bảng giá" rows). Null when the product is
 * not found in the caller's store.
 */
export async function loadProductPriceBookRows(productId: string, sku: string): Promise<ProductPriceBookRow[] | null> {
  const context = await requireStoreContext();
  const query = sku.trim();
  if (!query) return null;
  const books = await getPriceBooks(context.storeId, { includeManagerOnly: canViewPurchasePrices(context.role) });
  if (books.length === 0) return null;
  const page = await getPricingPage(context.storeId, { q: query, lifecycle: "all", page: 1, pageSize: 50 });
  const product = page.rows.find((row) => row.id === productId);
  if (!product) return null;
  const overrides = await getPriceOverridesForProducts(context.storeId, [product.id]);
  const source = { retailPrice: product.baseRetailPrice, costPrice: product.costPrice, lastPurchaseNetPrice: product.lastPurchaseNetPrice };
  return books.map((book) => ({
    id: book.id,
    name: book.name,
    price: book.isDefault ? Number(product.baseRetailPrice) : resolvePriceBookPrice(book, source, overrides[book.id]?.[product.id]),
  }));
}

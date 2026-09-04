import { resolvePriceBookPrice, systemPriceBookType, type SystemPriceBookType, type PriceBookSource } from "@/lib/pricing/system-price-books";

type ProductPriceSource = {
  costPrice?: string | null;
  lastPurchasePrice?: string | null;
  retailPrice: string;
  priceBookTypes?: Record<string, SystemPriceBookType | null>;
  prices: Record<string, string | null>;
  children: ProductPriceSource[];
};

/** One role-filtered projection for initial POS data and server search results. */
export function applySystemPriceBooks(
  rows: ProductPriceSource[],
  books: readonly (PriceBookSource & { id: string })[],
): void {
  for (const product of rows) {
    product.priceBookTypes = Object.fromEntries(books.map((book) => [book.id, systemPriceBookType(book)]));
    product.prices = Object.fromEntries(books.map((book) => {
      const price = resolvePriceBookPrice(book, product, product.prices[book.id]);
      return [book.id, price == null ? null : String(price)];
    }));
    applySystemPriceBooks(product.children, books);
    delete product.costPrice;
    delete product.lastPurchasePrice;
  }
}

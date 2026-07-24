import { normalizeSearch } from "@/lib/normalize";

export interface StocktakeSearchProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
}

export function getStocktakeSuggestions<T extends StocktakeSearchProduct>({
  search,
  localProducts,
  serverResults,
  addedProductIds,
  limit = 8,
}: {
  search: string;
  localProducts: T[];
  serverResults: T[];
  addedProductIds: Set<string>;
  limit?: number;
}): T[] {
  const query = normalizeSearch(search);
  if (!query) return [];

  const localResults = localProducts.filter((product) =>
    normalizeSearch(`${product.name} ${product.sku} ${product.barcode ?? ""}`).includes(query)
  );
  const candidates = serverResults.length > 0 ? serverResults : localResults;

  return candidates
    .filter((product) => !addedProductIds.has(product.id))
    .slice(0, limit);
}

export const PRICE_COMPARISON_OPERATORS = ["lt", "lte", "eq", "gte", "gt"] as const;
export type PriceComparisonOperator = (typeof PRICE_COMPARISON_OPERATORS)[number];
export type PriceComparisonReference = "cost" | "lastPurchase";

export type PriceComparison = {
  priceCondition?: PriceComparisonOperator;
  priceAgainst?: PriceComparisonReference;
  priceBookId?: string;
};

export function parsePriceComparisonParams(
  params: URLSearchParams | Record<string, string | undefined>,
): PriceComparison {
  const get = (key: string) => params instanceof URLSearchParams
    ? params.get(key)
    : params[key] ?? null;
  const priceCondition = get("priceCondition");
  const priceAgainst = get("priceAgainst");
  const validCondition = PRICE_COMPARISON_OPERATORS.includes(
    priceCondition as PriceComparisonOperator,
  ) ? priceCondition as PriceComparisonOperator : undefined;
  const validAgainst = priceAgainst === "cost" || priceAgainst === "lastPurchase"
    ? priceAgainst
    : undefined;
  return validCondition && validAgainst
    ? {
        priceCondition: validCondition,
        priceAgainst: validAgainst,
        priceBookId: get("priceBookId")?.trim() || undefined,
      }
    : {};
}

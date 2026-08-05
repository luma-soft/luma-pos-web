import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export type PricingStockFilter =
  | "negativeStock"
  | "outOfStock"
  | "lowStock"
  | "inStock"
  | "available";

export function pricingStockCondition(
  filter: string | undefined,
  availableStock: SQLWrapper,
  minStock: SQLWrapper,
): SQL | undefined {
  if (filter === "negativeStock") return sql`${availableStock} < 0`;
  if (filter === "outOfStock") return sql`${availableStock} = 0`;
  if (filter === "lowStock") {
    return sql`${availableStock} > 0 and ${availableStock} < ${minStock}`;
  }
  if (filter === "inStock") {
    return sql`${availableStock} > 0 and ${availableStock} >= ${minStock}`;
  }
  if (filter === "available") return sql`${availableStock} > 0`;
  return undefined;
}

export function matchesPricingStockFilter(
  filter: PricingStockFilter,
  availableStock: number,
  minStock: number,
): boolean {
  if (filter === "negativeStock") return availableStock < 0;
  if (filter === "outOfStock") return availableStock === 0;
  if (filter === "lowStock") {
    return availableStock > 0 && availableStock < minStock;
  }
  if (filter === "inStock") {
    return availableStock > 0 && availableStock >= minStock;
  }
  return availableStock > 0;
}

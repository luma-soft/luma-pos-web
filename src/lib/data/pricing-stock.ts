import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export type PricingStockFilter =
  | "negativeStock"
  | "outOfStock"
  | "lowStock"
  | "inStock"
  | "available";

export function pricingStockCondition(
  filter: string | undefined,
  totalStock: SQLWrapper,
  minStock: SQLWrapper,
): SQL | undefined {
  if (filter === "negativeStock") return sql`${totalStock} < 0`;
  if (filter === "outOfStock") return sql`${totalStock} = 0`;
  if (filter === "lowStock") {
    return sql`${totalStock} > 0 and ${totalStock} < ${minStock}`;
  }
  if (filter === "inStock") {
    return sql`${totalStock} > 0 and ${totalStock} >= ${minStock}`;
  }
  if (filter === "available") return sql`${totalStock} > 0`;
  return undefined;
}

export function matchesPricingStockFilter(
  filter: PricingStockFilter,
  totalStock: number,
  minStock: number,
): boolean {
  if (filter === "negativeStock") return totalStock < 0;
  if (filter === "outOfStock") return totalStock === 0;
  if (filter === "lowStock") {
    return totalStock > 0 && totalStock < minStock;
  }
  if (filter === "inStock") {
    return totalStock > 0 && totalStock >= minStock;
  }
  return totalStock > 0;
}

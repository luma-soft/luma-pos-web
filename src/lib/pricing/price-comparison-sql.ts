import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { lastPurchaseNetPriceSql } from "@/lib/pricing/last-purchase-net-price";
import type { PriceComparison } from "@/lib/pricing/price-comparison";

export function priceBookSellingPriceSql(
  storeId: string,
  product: { id: SQLWrapper; retailPrice: SQLWrapper; costPrice: SQLWrapper },
  priceBookId?: string,
): SQLWrapper {
  if (!priceBookId) return product.retailPrice;
  const lastPurchase = lastPurchaseNetPriceSql(storeId, product.id);
  return sql`(
    select case
      when price_filter_book.system_type = 'cost' or price_filter_book.cost_based then ${product.costPrice}
      when price_filter_book.system_type = 'purchase' then ${lastPurchase}
      when price_filter_book.system_type = 'list' then (
        select price_filter_override.price
        from product_prices price_filter_override
        where price_filter_override.product_id = ${product.id}
          and price_filter_override.store_id = ${storeId}
          and price_filter_override.price_book_id = price_filter_book.id
        limit 1
      )
      when price_filter_book.system_type = 'retail' or price_filter_book.is_default then ${product.retailPrice}
      else coalesce((
        select price_filter_override.price
        from product_prices price_filter_override
        where price_filter_override.product_id = ${product.id}
          and price_filter_override.store_id = ${storeId}
          and price_filter_override.price_book_id = price_filter_book.id
        limit 1
      ), ${product.retailPrice})
    end
    from price_books price_filter_book
    where price_filter_book.store_id = ${storeId}
      and price_filter_book.id = ${priceBookId}
    limit 1
  )`;
}

export function priceComparisonCondition(
  storeId: string,
  comparison: PriceComparison,
  product: { id: SQLWrapper; retailPrice: SQLWrapper; costPrice: SQLWrapper },
): SQL | undefined {
  const operator = comparison.priceCondition;
  const against = comparison.priceAgainst;
  if (!operator || !against) return undefined;

  const sellingPrice = priceBookSellingPriceSql(storeId, product, comparison.priceBookId);
  const referencePrice = against === "cost"
    ? product.costPrice
    : lastPurchaseNetPriceSql(storeId, product.id);

  switch (operator) {
    case "lt": return sql`${sellingPrice} < ${referencePrice}`;
    case "lte": return sql`${sellingPrice} <= ${referencePrice}`;
    case "eq": return sql`${sellingPrice} = ${referencePrice}`;
    case "gte": return sql`${sellingPrice} >= ${referencePrice}`;
    case "gt": return sql`${sellingPrice} > ${referencePrice}`;
  }
}

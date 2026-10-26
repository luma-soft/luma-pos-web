import { sql } from "drizzle-orm";
import { products, stocktakeItems, stocktakes } from "@/db/schema";

export function stocktakeListSummaryFields(storeId: string, canViewValues: boolean) {
  const productJoin = sql`inner join ${products} on ${stocktakeItems.productId} = ${products.id} and ${products.storeId} = ${storeId}`;
  const itemScope = sql`${stocktakeItems.stocktakeId} = ${stocktakes.id} and ${stocktakeItems.storeId} = ${storeId}`;

  return {
    productSummary: sql<string>`coalesce((
      select string_agg(product_summary.product_name, ' · ')
      from (
        select ${products.name} as product_name
        from ${stocktakeItems}
        ${productJoin}
        where ${itemScope}
        order by (${stocktakeItems.actualQty} <> ${stocktakeItems.systemQty}) desc, ${products.name} asc
        limit 2
      ) as product_summary
    ), '')`,
    netValue: canViewValues
      ? sql<string | null>`coalesce((
          select sum((${stocktakeItems.actualQty} - ${stocktakeItems.systemQty}) * ${products.costPrice})
          from ${stocktakeItems}
          ${productJoin}
          where ${itemScope}
        ), 0)::text`
      : sql<string | null>`null`,
  };
}

import { asc, sql } from "drizzle-orm";
import { orderItems, orders, products } from "@/db/schema";

/** Latest completed sale for a SKU; variant parents inherit their newest child sale. */
export function lastCompletedProductSaleAt() {
  return sql<Date | null>`case when ${products.isVariantParent} then (
    select max(${orders.createdAt})
    from ${orderItems}
    inner join ${orders} on ${orders.id} = ${orderItems.orderId}
    inner join products child on child.id = ${orderItems.productId}
    where child.parent_product_id = ${products.id}
      and ${orders.status} = 'completed'
  ) else (
    select max(${orders.createdAt})
    from ${orderItems}
    inner join ${orders} on ${orders.id} = ${orderItems.orderId}
    where ${orderItems.productId} = ${products.id}
      and ${orders.status} = 'completed'
  ) end`;
}

export function recentProductSaleOrder() {
  return [sql`${lastCompletedProductSaleAt()} desc nulls last`, asc(products.name), asc(products.id)] as const;
}

export function sortByRecentProductSale<T extends { id: string; name: string }>(
  rows: readonly T[],
  lastSoldAtByProduct: ReadonlyMap<string, Date | string | null>,
): T[] {
  const timestamp = (id: string) => {
    const value = lastSoldAtByProduct.get(id);
    return value ? new Date(value).getTime() : 0;
  };

  return [...rows].sort((left, right) => (
    timestamp(right.id) - timestamp(left.id)
    || left.name.localeCompare(right.name, "vi")
    || left.id.localeCompare(right.id)
  ));
}

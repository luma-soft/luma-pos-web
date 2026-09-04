import { sql } from "drizzle-orm";

/**
 * Latest received document, after line and allocated invoice discounts, before
 * tax/freight. Recorded line totals are authoritative for imported receipts too.
 * Multiple lines for one SKU are quantity-weighted in its base unit. Reading the
 * current document means edits/cancellations cannot leave a stale cached price.
 */
export function lastPurchaseNetPriceSql(storeId: string) {
  return sql<string | null>`(
    select round(
      sum(greatest(item.total, 0))
        * case when receipt_total.amount > 0
            then greatest(0, 1 - greatest(po.discount, 0) / receipt_total.amount)
            else 1 end
        / nullif(sum(item.quantity * item.unit_multiplier), 0), 2)
    from purchase_order_items item
    join purchase_orders po on po.id = item.purchase_order_id and po.store_id = item.store_id
    cross join lateral (
      select coalesce(sum(greatest(all_items.total, 0)), 0) as amount
      from purchase_order_items all_items
      where all_items.store_id = po.store_id and all_items.purchase_order_id = po.id
    ) receipt_total
    where item.store_id = ${storeId} and item.product_id = ${sql.raw('"products"."id"')}
      and po.status = 'received' and item.quantity > 0 and item.unit_multiplier > 0
    group by po.id, po.discount, po.cost_effective_at, po.created_at, receipt_total.amount
    order by coalesce(po.cost_effective_at, po.created_at) desc, po.id desc
    limit 1
  )`;
}

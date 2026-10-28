import { sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";

/**
 * Latest received document, after line and allocated invoice discounts, before
 * tax/freight. Recorded line totals are authoritative for imported receipts too.
 * Multiple lines for one SKU are quantity-weighted in its base unit. Reading the
 * current document means edits/cancellations cannot leave a stale cached price.
 */
export function lastPurchaseNetPriceSql(
  storeId: string,
  productId: SQLWrapper = sql.raw('"products"."id"'),
) {
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
    where item.store_id = ${storeId} and item.product_id = ${productId}
      and po.status = 'received' and item.quantity > 0 and item.unit_multiplier > 0
    group by po.id, po.discount, po.cost_effective_at, po.created_at, receipt_total.amount
    order by coalesce(po.cost_effective_at, po.created_at) desc, po.id desc
    limit 1
  )`;
}

/** Fetch the same value for a bounded set of products without a per-row subquery. */
export async function latestPurchaseNetPrices(
  storeId: string,
  productIds: readonly string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(productIds)];
  const result = new Map<string, string>();
  const batchSize = 500;

  for (let offset = 0; offset < uniqueIds.length; offset += batchSize) {
    const batch = uniqueIds.slice(offset, offset + batchSize);
    const productIDList = sql.join(batch.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await db.execute<{ productId: string; netPrice: string }>(sql`
      with relevant_receipts as (
        select distinct candidate.purchase_order_id
        from purchase_order_items candidate
        join purchase_orders candidate_po
          on candidate_po.id = candidate.purchase_order_id
          and candidate_po.store_id = candidate.store_id
        where candidate.store_id = ${storeId}::uuid
          and candidate.product_id in (${productIDList})
          and candidate_po.status = 'received'
          and candidate.quantity > 0
          and candidate.unit_multiplier > 0
      ), receipt_totals as (
        select receipt_item.purchase_order_id,
          sum(greatest(receipt_item.total, 0)) as amount
        from purchase_order_items receipt_item
        join relevant_receipts using (purchase_order_id)
        where receipt_item.store_id = ${storeId}::uuid
        group by receipt_item.purchase_order_id
      ), product_receipts as (
        select item.product_id,
          po.id as purchase_order_id,
          coalesce(po.cost_effective_at, po.created_at) as effective_at,
          round(
            sum(greatest(item.total, 0))
              * case when receipt_total.amount > 0
                  then greatest(0, 1 - greatest(po.discount, 0) / receipt_total.amount)
                  else 1 end
              / nullif(sum(item.quantity * item.unit_multiplier), 0),
            2
          ) as net_price
        from purchase_order_items item
        join purchase_orders po
          on po.id = item.purchase_order_id
          and po.store_id = item.store_id
        join receipt_totals receipt_total on receipt_total.purchase_order_id = po.id
        where item.store_id = ${storeId}::uuid
          and item.product_id in (${productIDList})
          and po.status = 'received'
          and item.quantity > 0
          and item.unit_multiplier > 0
        group by item.product_id, po.id, po.discount, po.cost_effective_at,
          po.created_at, receipt_total.amount
      )
      select distinct on (product_id)
        product_id as "productId",
        net_price as "netPrice"
      from product_receipts
      order by product_id, effective_at desc, purchase_order_id desc
    `);
    for (const row of rows.rows) result.set(row.productId, row.netPrice);
  }

  return result;
}

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { orderItems, orders } from "@/db/schema";

/**
 * Invoice discounts are stored on the order, separately from line totals.
 * Spread the effective discount across lines in proportion to their net value.
 */
export function orderItemDiscountShareSql() {
  return sql`
    case
      when ${orders.subtotal} > 0 then
        least(greatest(${orders.discount}, 0), ${orders.subtotal})
        * ${orderItems.total} / ${orders.subtotal}
      else 0
    end
  `;
}

export function orderItemNetRevenueSql() {
  return sql`${orderItems.total} - (${orderItemDiscountShareSql()})`;
}

export function orderItemGrossProfitSql(costPrice: AnyPgColumn) {
  return sql`
    ${orderItemNetRevenueSql()}
    - (${orderItems.quantity} * ${orderItems.unitMultiplier} * ${costPrice})
  `;
}

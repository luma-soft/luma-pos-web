import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, products } from "@/db/schema";

const COVER_DAYS = 14;

export type RestockPriority = "high" | "medium" | "low";
export type RestockRow = {
  id: string; name: string; sku: string; baseUnit: string;
  stock: number; velocity: number; daysOfStock: number | null; suggestedQty: number; priority: RestockPriority;
};

/** Gợi ý nhập hàng (deterministic) từ tốc độ bán {days} ngày gần nhất. */
export async function getRestockSuggestions(days = 30): Promise<RestockRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const sold = await db
    .select({
      productId: orderItems.productId,
      base: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitMultiplier}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(inArray(orders.status, ["completed", "returned"]), gte(orders.createdAt, since)))
    .groupBy(orderItems.productId);
  const soldMap = new Map(sold.map((r) => [r.productId, Number(r.base)]));

  const prods = await db
    .select({ id: products.id, name: products.name, sku: products.sku, baseUnit: products.baseUnit, totalStock: products.totalStock, minStock: products.minStock })
    .from(products)
    .where(eq(products.isActive, true));

  const rows: RestockRow[] = [];
  for (const p of prods) {
    const stock = Number(p.totalStock);
    const min = Number(p.minStock);
    const velocity = (soldMap.get(p.id) ?? 0) / days;
    const lowStock = min > 0 && stock <= min;
    if (velocity <= 0 && !lowStock) continue; // bỏ SP không bán & đủ tồn

    const daysOfStock = velocity > 0 ? stock / velocity : null;
    const suggestedQty = Math.max(0, Math.ceil(velocity * COVER_DAYS) - stock);
    const priority: RestockPriority =
      daysOfStock != null && daysOfStock < 7 ? "high"
      : daysOfStock != null && daysOfStock < 14 ? "medium"
      : lowStock ? "high" : "low";

    rows.push({ id: p.id, name: p.name, sku: p.sku, baseUnit: p.baseUnit, stock, velocity, daysOfStock, suggestedQty, priority });
  }

  const order: Record<RestockPriority, number> = { high: 0, medium: 1, low: 2 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || (a.daysOfStock ?? 1e9) - (b.daysOfStock ?? 1e9));
  return rows.slice(0, 100);
}

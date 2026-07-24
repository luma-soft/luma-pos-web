import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, orderItems, orders, products } from "@/db/schema";
import {
  calculateRestock,
  type RestockPriority,
} from "@/lib/ai/restock-policy";
import { stockManagedCategoryCondition } from "@/lib/data/product-stock";

export type { RestockPriority } from "@/lib/ai/restock-policy";

export type RestockRow = {
  id: string; name: string; sku: string; baseUnit: string;
  stock: number; velocity: number; daysOfStock: number | null; suggestedQty: number; priority: RestockPriority;
  unitCost: number;
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
    .select({ id: products.id, name: products.name, sku: products.sku, baseUnit: products.baseUnit, totalStock: products.totalStock, minStock: products.minStock, costPrice: products.costPrice, lastPurchasePrice: products.lastPurchasePrice })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.isActive, true), stockManagedCategoryCondition()));

  const rows: RestockRow[] = [];
  for (const p of prods) {
    const stock = Number(p.totalStock);
    const min = Number(p.minStock);
    const calculation = calculateRestock({
      stock,
      minStock: min,
      soldQuantity: soldMap.get(p.id) ?? 0,
      lookbackDays: days,
    });
    const { velocity, lowStock, daysOfStock, suggestedQty, priority } = calculation;
    if (velocity <= 0 && !lowStock) continue; // bỏ SP không bán & đủ tồn

    rows.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      baseUnit: p.baseUnit,
      stock,
      velocity,
      daysOfStock,
      suggestedQty,
      priority,
      unitCost: Number(p.lastPurchasePrice ?? p.costPrice ?? 0),
    });
  }

  const order: Record<RestockPriority, number> = { high: 0, medium: 1, low: 2 };
  rows.sort((a, b) => order[a.priority] - order[b.priority] || (a.daysOfStock ?? 1e9) - (b.daysOfStock ?? 1e9));
  return rows.slice(0, 100);
}

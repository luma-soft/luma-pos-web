import { and, eq, inArray } from "drizzle-orm";
import { priceBooks, productPrices } from "@/db/schema";
import type { InventoryTransaction } from "@/lib/inventory/stock-lot-service";
import { recordActivity } from "@/lib/audit/activity-log";

export function changedReceiptCompanyPriceItems<T extends { productId: string; unitCost: number }>(
  items: readonly T[],
  previousItems?: readonly { productId: string; unitCost: string | number }[],
): T[] {
  if (!previousItems) return [...items];
  const previousGrossPrices = new Map<string, Set<string>>();
  for (const item of previousItems) {
    const values = previousGrossPrices.get(item.productId) ?? new Set<string>();
    values.add(Number(item.unitCost).toFixed(2));
    previousGrossPrices.set(item.productId, values);
  }
  return items.filter((item) => {
    const previous = previousGrossPrices.get(item.productId);
    return previous?.size !== 1 || !previous.has(item.unitCost.toFixed(2));
  });
}

/**
 * Keep the company list price aligned with the gross receipt price. Receipt
 * discounts remain separate and therefore never reduce this list price.
 */
export async function updateReceiptCompanyPrices(
  tx: InventoryTransaction,
  context: { storeId: string; userId: string; role: string },
  receiptId: string,
  items: readonly { productId: string; unitCost: number }[],
) {
  if (!items.length) return;
  const prices = new Map<string, number>();
  for (const item of items) {
    const price = Number(item.unitCost.toFixed(2));
    if (prices.has(item.productId) && prices.get(item.productId) !== price) throw new Error("COMPANY_PRICE_CONFLICT");
    prices.set(item.productId, price);
  }
  const [book] = await tx.select({ id: priceBooks.id, name: priceBooks.name }).from(priceBooks)
    .where(and(eq(priceBooks.storeId, context.storeId), eq(priceBooks.systemType, "list"))).limit(1);
  if (!book) throw new Error("COMPANY_PRICE_UNAVAILABLE");
  const previous = await tx.select({ productId: productPrices.productId, price: productPrices.price }).from(productPrices)
    .where(and(eq(productPrices.storeId, context.storeId), eq(productPrices.priceBookId, book.id), inArray(productPrices.productId, [...prices.keys()])));
  const old = new Map(previous.map((row) => [row.productId, Number(row.price)]));
  for (const [productId, price] of prices) {
    if (old.get(productId) === price) continue;
    await tx.insert(productPrices).values({ storeId: context.storeId, priceBookId: book.id, productId, price: price.toFixed(2) })
      .onConflictDoUpdate({ target: [productPrices.priceBookId, productPrices.productId], set: { price: price.toFixed(2) } });
    await recordActivity(tx, {
      storeId: context.storeId, actorId: context.userId, action: "product.price_book.updated", entityType: "product", entityId: productId,
      before: { price: old.get(productId) ?? null }, after: { price },
      metadata: { priceBookId: book.id, priceBookName: book.name, receiptId, source: "receipt_automatic", beforeSupplierDiscount: true },
    });
  }
}

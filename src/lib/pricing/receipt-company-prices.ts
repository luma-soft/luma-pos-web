import { and, eq, inArray } from "drizzle-orm";
import { priceBooks, productPrices } from "@/db/schema";
import type { InventoryTransaction } from "@/lib/inventory/stock-lot-service";
import { recordActivity } from "@/lib/audit/activity-log";

/** Explicit receipt opt-in only; normal receipt discounts never alter list prices. */
export async function updateReceiptCompanyPrices(
  tx: InventoryTransaction,
  context: { storeId: string; userId: string; role: string },
  receiptId: string,
  items: readonly { productId: string; unitCost: number; updateCompanyPrice?: boolean }[],
) {
  const selected = items.filter((item) => item.updateCompanyPrice);
  if (!selected.length) return;
  if (context.role !== "owner" && context.role !== "manager") throw new Error("COMPANY_PRICE_FORBIDDEN");
  const prices = new Map<string, number>();
  for (const item of selected) {
    if (prices.has(item.productId) && prices.get(item.productId) !== item.unitCost) throw new Error("COMPANY_PRICE_CONFLICT");
    prices.set(item.productId, item.unitCost);
  }
  const [book] = await tx.select({ id: priceBooks.id, name: priceBooks.name }).from(priceBooks)
    .where(and(eq(priceBooks.storeId, context.storeId), eq(priceBooks.systemType, "list"))).limit(1);
  if (!book) throw new Error("COMPANY_PRICE_UNAVAILABLE");
  const previous = await tx.select({ productId: productPrices.productId, price: productPrices.price }).from(productPrices)
    .where(and(eq(productPrices.storeId, context.storeId), eq(productPrices.priceBookId, book.id), inArray(productPrices.productId, [...prices.keys()])));
  const old = new Map(previous.map((row) => [row.productId, Number(row.price)]));
  for (const [productId, price] of prices) {
    await tx.insert(productPrices).values({ storeId: context.storeId, priceBookId: book.id, productId, price: price.toFixed(2) })
      .onConflictDoUpdate({ target: [productPrices.priceBookId, productPrices.productId], set: { price: price.toFixed(2) } });
    await recordActivity(tx, {
      storeId: context.storeId, actorId: context.userId, action: "product.price_book.updated", entityType: "product", entityId: productId,
      before: { price: old.get(productId) ?? null }, after: { price },
      metadata: { priceBookId: book.id, priceBookName: book.name, receiptId, source: "receipt_opt_in", beforeSupplierDiscount: true },
    });
  }
}

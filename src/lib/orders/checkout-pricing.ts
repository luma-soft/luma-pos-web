import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { catalogSyncState, products } from "@/db/schema";
import type { CreateOrderOutput } from "@/lib/schemas/order";
import { normalizeOrderItems, type NormalizedOrderItem } from "./normalize";

type OrderTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const CHECKOUT_PRICING_CHANGED = "pos.errors.pricingChanged";

const moneyEquals = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && a.toFixed(2) === b.toFixed(2);
const factorEquals = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.000000001;

/** The snapshot is an expectation, never an authority to set the price. */
export function assertCheckoutPricing(
  input: CreateOrderOutput,
  items: NormalizedOrderItem[],
  authorizedItems?: NormalizedOrderItem[],
) {
  const expected = input.expectedPricing?.lines;
  if (expected && (expected.length !== items.length || expected.some((line, index) => {
    const item = items[index];
    return line.productId !== item.productId || line.unitName !== item.unitName ||
      !factorEquals(line.unitMultiplier, item.unitMultiplier) || !moneyEquals(line.unitPrice, item.unitPrice);
  }))) throw new Error(CHECKOUT_PRICING_CHANGED);

  // Approval was obtained for these server-resolved values. A price/promotion
  // change must not increase the discount ratio after that authorization.
  if (authorizedItems && (authorizedItems.length !== items.length || authorizedItems.some((line, index) => {
    const item = items[index];
    return line.productId !== item.productId || line.unitName !== item.unitName ||
      line.quantity !== item.quantity || !factorEquals(line.unitMultiplier, item.unitMultiplier) ||
      !moneyEquals(line.preDiscountUnitPrice, item.preDiscountUnitPrice) ||
      !moneyEquals(line.lineDiscount, item.lineDiscount) || !moneyEquals(line.unitPrice, item.unitPrice);
  }))) throw new Error(CHECKOUT_PRICING_CHANGED);
}

/**
 * Must run in the order-writing READ COMMITTED transaction, before ANY business
 * write, including cancellation/restoration of an edited source order.
 *
 * Read the tenant revision before all pricing reads, then lock and recheck it.
 * A committed mutation between queries is rejected; an uncommitted writer must
 * finish its revision trigger before it can commit. Once fenced it cannot commit
 * until this order commits/rolls back. This also covers missing override/promo
 * rows, which individual row locks would miss. Keep the lock through commit.
 */
export async function prepareCheckoutPricing(
  tx: OrderTransaction,
  storeId: string,
  input: CreateOrderOutput,
  role: string,
  authorizedItems?: NormalizedOrderItem[],
) {
  // Existing inventory writers can hold a stock/product lock before their
  // catalog trigger. Bound that lock inversion; callers must roll back on it.
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const condition = and(eq(catalogSyncState.storeId, storeId), eq(catalogSyncState.id, 1));
  const [before] = await tx.select({ revision: sql<string>`${catalogSyncState.revision}::text` })
    .from(catalogSyncState).where(condition);
  if (!before) throw new Error(CHECKOUT_PRICING_CHANGED);

  const items = await normalizeOrderItems(storeId, input.items, input.priceBookId, role, tx);
  const taxes = await tx.select({ id: products.id, vatRate: products.vatRate }).from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, [...new Set(items.map((item) => item.productId))])));

  const [locked] = await tx.select({ revision: sql<string>`${catalogSyncState.revision}::text` })
    .from(catalogSyncState).where(condition).for("update", { noWait: true });
  if (!locked || before.revision !== locked.revision) throw new Error(CHECKOUT_PRICING_CHANGED);
  assertCheckoutPricing(input, items, authorizedItems);
  return {
    items,
    vatRateByProduct: new Map(taxes.map((product) => [product.id, product.vatRate == null ? null : Number(product.vatRate)])),
  };
}

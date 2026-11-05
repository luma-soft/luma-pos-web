import { and, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { catalogSyncState, products } from "@/db/schema";
import type { CreateOrderOutput } from "@/lib/schemas/order";
import { normalizeOrderItems, type NormalizedOrderItem } from "./normalize";

type OrderTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const CHECKOUT_PRICING_CHANGED = "pos.errors.pricingChanged";
export const CHECKOUT_CATALOG_RACE = "CHECKOUT_CATALOG_RACE";

const moneyEquals = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && a.toFixed(2) === b.toFixed(2);
const factorEquals = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.000000001;

/** Return changed price line indexes only when product and unit identity still match. */
export function checkoutPriceMismatchIndexes(
  input: CreateOrderOutput,
  items: NormalizedOrderItem[],
): number[] | null {
  const expected = input.expectedPricing?.lines;
  if (!expected || expected.length !== items.length) return null;
  const changed: number[] = [];
  for (const [index, line] of expected.entries()) {
    const item = items[index];
    if (line.productId !== item.productId || line.unitName !== item.unitName ||
      !factorEquals(line.unitMultiplier, item.unitMultiplier)) return null;
    if (!moneyEquals(line.unitPrice, item.unitPrice)) changed.push(index);
  }
  return changed;
}

/** The snapshot is an expectation, never an authority to set the price. */
export function assertCheckoutPricing(
  input: CreateOrderOutput,
  items: NormalizedOrderItem[],
  authorizedItems?: NormalizedOrderItem[],
) {
  const priceMismatches = checkoutPriceMismatchIndexes(input, items);
  if (input.expectedPricing && (priceMismatches == null || priceMismatches.length > 0)) {
    throw new Error(CHECKOUT_PRICING_CHANGED);
  }

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

  let pricingInput = input;
  let items = await normalizeOrderItems(storeId, pricingInput.items, pricingInput.priceBookId, role, tx);
  const taxes = await tx.select({ id: products.id, vatRate: products.vatRate }).from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, [...new Set(items.map((item) => item.productId))])));

  const [locked] = await tx.select({ revision: sql<string>`${catalogSyncState.revision}::text` })
    .from(catalogSyncState).where(condition).for("update", { noWait: true });
  if (!locked) throw new Error(CHECKOUT_PRICING_CHANGED);
  // The catalog revision also advances for stock changes. A revision race is
  // retried by the order writer; the next attempt re-resolves prices and still
  // rejects if the cashier's snapshot is actually stale.
  if (before.revision !== locked.revision) throw new Error(CHECKOUT_CATALOG_RACE);

  const priceMismatches = checkoutPriceMismatchIndexes(pricingInput, items);
  if (priceMismatches?.length) {
    // Only managers and owners may approve a stale sale price as an explicit
    // override. Cashier submissions keep failing closed if the catalog changes
    // between the action's preflight and this transaction.
    if (role !== "owner" && role !== "manager") throw new Error(CHECKOUT_PRICING_CHANGED);
    const lockedItems = pricingInput.items.map((item, index) => {
      if (!priceMismatches.includes(index) || item.manualUnitPrice != null) return item;
      if (item.invoiceUnitPrice == null) throw new Error(CHECKOUT_PRICING_CHANGED);
      return { ...item, manualUnitPrice: item.invoiceUnitPrice };
    });
    pricingInput = { ...pricingInput, items: lockedItems };
    items = await normalizeOrderItems(storeId, pricingInput.items, pricingInput.priceBookId, role, tx);
  }

  assertCheckoutPricing(pricingInput, items, authorizedItems);
  return {
    items,
    vatRateByProduct: new Map(taxes.map((product) => [product.id, product.vatRate == null ? null : Number(product.vatRate)])),
  };
}

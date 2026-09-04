import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  inventoryCostAdjustments, inventoryCostBaselines, products,
  purchaseOrderItems, purchaseOrders, returns, stockMovements,
} from "@/db/schema";
import { calculatePurchaseCosts, replayMovingAverage } from "@/lib/purchases/cost-calculations";
import type { InventoryTransaction } from "./stock-lot-service";

const uniqueIds = (ids: readonly string[]) => [...new Set(ids)].sort();
const quantity = (value: number) => Math.round(value * 10000) / 10000;
const receiptTime = sql`coalesce(${purchaseOrders.costEffectiveAt}, ${purchaseOrders.createdAt})`;

function costError(code: "COST_HISTORY_LOCKED" | "COST_LEDGER_MISMATCH" | "COST_PRODUCT_NOT_FOUND") {
  return Object.assign(new Error(code), { code });
}

async function lockProducts(tx: InventoryTransaction, storeId: string, ids: readonly string[]) {
  const sorted = uniqueIds(ids);
  if (!sorted.length) return [];
  const rows = await tx.select({
    id: products.id, quantity: products.totalStock,
    unitCost: products.costPrice, grossUnitCost: products.lastPurchasePrice,
  }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, sorted)))
    .orderBy(asc(products.id)).for("update");
  if (rows.length !== sorted.length) throw costError("COST_PRODUCT_NOT_FOUND");
  return rows;
}

/** Capture a reconciled opening balance before the first tracked stock mutation. */
export async function ensureInventoryCostBaselines(tx: InventoryTransaction, storeId: string, ids: readonly string[]) {
  const rows = await lockProducts(tx, storeId, ids);
  if (!rows.length) return;
  await tx.insert(inventoryCostBaselines).values(rows.map((row) => ({
    storeId, productId: row.id, quantity: row.quantity,
    unitCost: row.unitCost, grossUnitCost: row.grossUnitCost,
    effectiveAt: sql`clock_timestamp()`,
  }))).onConflictDoNothing();
}

/** Older receipts are already inside the opening balance and cannot be replayed. */
export async function assertPurchaseCostPeriod(
  tx: InventoryTransaction, storeId: string, po: { id: string; status: string }, productIds: readonly string[],
) {
  if (po.status !== "received" || !productIds.length) return;
  // Compare database timestamps directly: JS Date would discard microseconds.
  const locked = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders)
    .innerJoin(inventoryCostBaselines, and(
      eq(inventoryCostBaselines.storeId, purchaseOrders.storeId),
      inArray(inventoryCostBaselines.productId, uniqueIds(productIds)),
    )).where(and(eq(purchaseOrders.storeId, storeId), eq(purchaseOrders.id, po.id),
      sql`${receiptTime} < ${inventoryCostBaselines.effectiveAt}`)).limit(1);
  if (locked.length) throw costError("COST_HISTORY_LOCKED");
}

/** Record a deliberate cost override without erasing the receipt replay period. */
export async function recordManualInventoryCost(
  tx: InventoryTransaction, storeId: string, productId: string, nextCost: number,
) {
  if (!Number.isFinite(nextCost) || nextCost < 0) throw new RangeError("Invalid inventory cost");
  const [product] = await lockProducts(tx, storeId, [productId]);
  const rounded = nextCost.toFixed(2);
  if (Number(product.unitCost) === Number(rounded)) return;
  const [basis] = await tx.select({ productId: inventoryCostBaselines.productId }).from(inventoryCostBaselines)
    .where(and(eq(inventoryCostBaselines.storeId, storeId), eq(inventoryCostBaselines.productId, productId))).limit(1);
  if (!basis) return;
  await tx.insert(inventoryCostAdjustments).values({
    storeId, productId, unitCost: rounded, effectiveAt: sql`clock_timestamp()`, reason: "manual",
  });
}

type ValuationEvent = {
  id: string;
  at: string;
  kind: "receipt" | "movement" | "adjustment";
  quantity: number;
  unitCost?: number | null;
  grossUnitCost?: number;
  saleOrderId?: string | null;
  returnOrderId?: string | null;
  restoresOrderSale?: boolean;
};

/**
 * Replay current received documents, ordinary stock movements and explicit cost
 * overrides from the opening balance. Purchase audit reversals are excluded:
 * the current receipt lines/status are authoritative after an edit or cancel.
 */
export async function revalueInventoryProducts(tx: InventoryTransaction, storeId: string, ids: readonly string[]) {
  const lockedProducts = await lockProducts(tx, storeId, ids);
  if (!lockedProducts.length) return;
  const baselines = await tx.select().from(inventoryCostBaselines).where(and(
    eq(inventoryCostBaselines.storeId, storeId), inArray(inventoryCostBaselines.productId, lockedProducts.map((row) => row.id)),
  ));
  if (!baselines.length) return;
  const trackedIds = baselines.map((row) => row.productId);
  const events = new Map(trackedIds.map((id) => [id, [] as ValuationEvent[]]));

  const eligible = await tx.selectDistinct({
    receiptId: purchaseOrders.id, productId: purchaseOrderItems.productId,
  }).from(purchaseOrderItems).innerJoin(purchaseOrders, and(
    eq(purchaseOrders.storeId, purchaseOrderItems.storeId), eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId),
  )).innerJoin(inventoryCostBaselines, and(
    eq(inventoryCostBaselines.storeId, purchaseOrderItems.storeId), eq(inventoryCostBaselines.productId, purchaseOrderItems.productId),
  )).where(and(eq(purchaseOrders.storeId, storeId), eq(purchaseOrders.status, "received"),
    inArray(purchaseOrderItems.productId, trackedIds), sql`${receiptTime} >= ${inventoryCostBaselines.effectiveAt}`));
  const eligibleKeys = new Set(eligible.map((row) => `${row.receiptId}:${row.productId}`));
  const receiptIds = uniqueIds(eligible.map((row) => row.receiptId));
  if (receiptIds.length) {
    // All lines are needed, including other products, for invoice allocation.
    const rows = await tx.select({
      receiptId: purchaseOrders.id, discount: purchaseOrders.discount, vatRate: purchaseOrders.vatRate,
      shippingFee: purchaseOrders.shippingFee,
      at: sql<string>`to_char(${receiptTime} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`,
      item: purchaseOrderItems,
    }).from(purchaseOrders).innerJoin(purchaseOrderItems, and(
      eq(purchaseOrderItems.storeId, purchaseOrders.storeId), eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id),
    )).where(and(eq(purchaseOrders.storeId, storeId), inArray(purchaseOrders.id, receiptIds)))
      .orderBy(asc(purchaseOrders.id), asc(purchaseOrderItems.id));
    const receipts = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = receipts.get(row.receiptId) ?? [];
      group.push(row);
      receipts.set(row.receiptId, group);
    }
    for (const [receiptId, lines] of receipts) {
      const costs = calculatePurchaseCosts({
        items: lines.map(({ item }) => ({ quantity: Number(item.quantity), unitCost: Number(item.unitCost), discount: Number(item.discount) })),
        discount: Number(lines[0].discount), vatRate: Number(lines[0].vatRate), shippingFee: Number(lines[0].shippingFee),
      });
      const grouped = new Map<string, { quantity: number; gross: number; landed: number }>();
      lines.forEach(({ item }, index) => {
        if (!eligibleKeys.has(`${receiptId}:${item.productId}`)) return;
        const multiplier = Number(item.unitMultiplier);
        if (!Number.isFinite(multiplier) || multiplier <= 0) throw costError("COST_LEDGER_MISMATCH");
        const baseQuantity = quantity(Number(item.quantity) * multiplier);
        if (baseQuantity <= 0) throw costError("COST_LEDGER_MISMATCH");
        const group = grouped.get(item.productId) ?? { quantity: 0, gross: 0, landed: 0 };
        group.quantity += baseQuantity;
        group.gross += costs.lines[index].quantity * costs.lines[index].grossUnitCost;
        group.landed += costs.lines[index].landedTotal;
        grouped.set(item.productId, group);
      });
      for (const [productId, group] of grouped) events.get(productId)!.push({
        id: receiptId, at: lines[0].at, kind: "receipt", quantity: quantity(group.quantity),
        unitCost: group.landed / group.quantity, grossUnitCost: group.gross / group.quantity,
      });
    }
  }

  const movements = await tx.select({
    id: stockMovements.id, productId: stockMovements.productId, type: stockMovements.type,
    quantity: stockMovements.quantity, unitCost: stockMovements.unitCost,
    refType: stockMovements.refType, refId: stockMovements.refId, returnOrderId: returns.orderId, returnStatus: returns.status,
    at: sql<string>`to_char(${stockMovements.createdAt} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`,
  }).from(stockMovements).innerJoin(inventoryCostBaselines, and(
    eq(inventoryCostBaselines.storeId, stockMovements.storeId), eq(inventoryCostBaselines.productId, stockMovements.productId),
  )).leftJoin(returns, and(eq(returns.storeId, stockMovements.storeId), eq(returns.id, stockMovements.refId),
    inArray(stockMovements.refType, ["return", "exchange_return", "return_cancel"]),
  )).where(and(eq(stockMovements.storeId, storeId), inArray(stockMovements.productId, trackedIds),
    sql`${stockMovements.createdAt} >= ${inventoryCostBaselines.effectiveAt}`,
    sql`(${stockMovements.refType} is null or ${stockMovements.refType} not in ('purchase', 'purchase_edit', 'purchase_cancel'))`,
  ));
  // Cancelled returns that were received within this period are removed along
  // with their audit reversal. A pre-baseline return is already in the opening
  // balance, so its later cancellation must remain a quantity-only movement.
  const cancelledReturns = new Set(movements.filter((movement) => movement.type === "return_in"
    && movement.returnStatus === "cancelled" && ["return", "exchange_return"].includes(movement.refType ?? ""))
    .map((movement) => `${movement.productId}:${movement.refId}`));
  for (const movement of movements) {
    if (["return", "exchange_return", "return_cancel"].includes(movement.refType ?? "")
      && cancelledReturns.has(`${movement.productId}:${movement.refId}`)) continue;
    events.get(movement.productId)!.push({
      id: movement.id, at: movement.at, kind: "movement", quantity: Number(movement.quantity),
      // Supplier refunds and sale prices must never become inventory costs.
      unitCost: movement.type === "return_in" && movement.unitCost != null ? Number(movement.unitCost) : null,
      saleOrderId: movement.type === "sale" && ["order", "exchange_order"].includes(movement.refType ?? "") ? movement.refId : null,
      returnOrderId: movement.type === "return_in"
        ? ["order_cancel", "order_edit_cancel"].includes(movement.refType ?? "") ? movement.refId : movement.returnOrderId : null,
      restoresOrderSale: ["order_cancel", "order_edit_cancel"].includes(movement.refType ?? ""),
    });
  }
  const adjustments = await tx.select({
    id: inventoryCostAdjustments.id, productId: inventoryCostAdjustments.productId, unitCost: inventoryCostAdjustments.unitCost,
    at: sql<string>`to_char(${inventoryCostAdjustments.effectiveAt} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`,
  }).from(inventoryCostAdjustments).innerJoin(inventoryCostBaselines, and(
    eq(inventoryCostBaselines.storeId, inventoryCostAdjustments.storeId),
    eq(inventoryCostBaselines.productId, inventoryCostAdjustments.productId),
  )).where(and(eq(inventoryCostAdjustments.storeId, storeId), inArray(inventoryCostAdjustments.productId, trackedIds),
    sql`${inventoryCostAdjustments.effectiveAt} >= ${inventoryCostBaselines.effectiveAt}`));
  for (const adjustment of adjustments) events.get(adjustment.productId)!.push({
    id: adjustment.id, at: adjustment.at, kind: "adjustment", quantity: 0, unitCost: Number(adjustment.unitCost),
  });

  const priority = { receipt: 0, movement: 1, adjustment: 2 };
  for (const basis of baselines) {
    let state = { quantity: Number(basis.quantity), unitCost: Number(basis.unitCost) };
    let gross = basis.grossUnitCost == null ? null : Number(basis.grossUnitCost);
    const saleCosts = new Map<string, { quantity: number; value: number }>();
    const timeline = events.get(basis.productId)!.sort((a, b) => a.at.localeCompare(b.at)
      || priority[a.kind] - priority[b.kind] || a.id.localeCompare(b.id));
    for (const event of timeline) {
      if (event.kind === "adjustment") {
        state.unitCost = event.unitCost!;
        continue;
      }
      if (event.saleOrderId && event.quantity < 0) {
        const sale = saleCosts.get(event.saleOrderId) ?? { quantity: 0, value: 0 };
        sale.quantity -= event.quantity;
        sale.value -= event.quantity * state.unitCost;
        saleCosts.set(event.saleOrderId, sale);
      }
      const originalSale = event.returnOrderId ? saleCosts.get(event.returnOrderId) : undefined;
      const incomingCost = originalSale ? originalSale.value / originalSale.quantity : event.unitCost;
      // Old sales have no cost snapshot in order_items. Their returns preserve
      // the running average instead of inventing a cost from the refund amount.
      state = replayMovingAverage(state, [{
        kind: event.kind === "receipt" || (event.quantity > 0 && incomingCost != null) ? "receipt" : "movement",
        quantity: event.quantity, unitCost: incomingCost,
      }]);
      // In-place edits reuse the order ID. Once its old sale is restored, a
      // replacement sale must build a fresh cost record for subsequent returns.
      if (event.restoresOrderSale && event.quantity > 0 && originalSale && event.returnOrderId) {
        const remaining = quantity(originalSale.quantity - event.quantity);
        if (remaining <= 0) saleCosts.delete(event.returnOrderId);
        else saleCosts.set(event.returnOrderId, { quantity: remaining, value: remaining * incomingCost! });
      }
      if (event.kind === "receipt") gross = event.grossUnitCost!;
    }
    const product = lockedProducts.find((row) => row.id === basis.productId)!;
    if (quantity(state.quantity) !== quantity(Number(product.quantity))) throw costError("COST_LEDGER_MISMATCH");
    await tx.update(products).set({ costPrice: state.unitCost.toFixed(2), lastPurchasePrice: gross == null ? null : gross.toFixed(2) })
      .where(and(eq(products.storeId, storeId), eq(products.id, basis.productId)));
  }
}

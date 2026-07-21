import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { products, productPrices, productUnits, promotions } from "@/db/schema";
import { applyPromo, isPromoActive } from "@/lib/promo";
import type { CreateOrderOutput, UpdateOrderOutput } from "@/lib/schemas/order";

type RawOrderItem = CreateOrderOutput["items"][number] | UpdateOrderOutput["items"][number];

export type NormalizedOrderItem = {
  productId: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  preDiscountUnitPrice: number;
  lineDiscount: number;
  unitPrice: number;
  total: number;
};

function listedUnitPrice(
  product: {
    retailPrice: string;
  },
  unit: { multiplier: string; priceOverride: string | null } | null,
  priceBookPrice: string | undefined
) {
  const base = Number(priceBookPrice ?? product.retailPrice);
  if (!unit) return base;
  if (unit.priceOverride != null) {
    const retail = Number(product.retailPrice);
    const ratio = retail > 0 ? base / retail : 1;
    return Math.round(Number(unit.priceOverride) * ratio);
  }
  return Math.round(base * Number(unit.multiplier));
}

/**
 * Convert client order lines into trusted order item snapshots.
 *
 * The client may still request a manual price/discount so existing POS flows keep
 * working, but product names, units, multipliers, default prices, and promotions
 * are all resolved from the database here.
 */
export async function normalizeOrderItems(
  rawItems: RawOrderItem[],
  priceBookId?: string | null
): Promise<NormalizedOrderItem[]> {
  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  if (productIds.length === 0) throw new Error("INVALID_ITEMS");

  const [productRows, unitRows, priceRows, promoRows] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        baseUnit: products.baseUnit,
        retailPrice: products.retailPrice,
        isActive: products.isActive,
      })
      .from(products)
      .where(inArray(products.id, productIds)),
    db
      .select({
        productId: productUnits.productId,
        unitName: productUnits.unitName,
        multiplier: productUnits.multiplier,
        priceOverride: productUnits.priceOverride,
      })
      .from(productUnits)
      .where(inArray(productUnits.productId, productIds)),
    priceBookId
      ? db
          .select({ productId: productPrices.productId, price: productPrices.price })
          .from(productPrices)
          .where(and(eq(productPrices.priceBookId, priceBookId), inArray(productPrices.productId, productIds)))
      : Promise.resolve([]),
    db
      .select({
        productId: promotions.productId,
        tiers: promotions.tiers,
        isActive: promotions.isActive,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
      })
      .from(promotions)
      .where(and(eq(promotions.isActive, true), inArray(promotions.productId, productIds))),
  ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const priceByProduct = new Map(priceRows.map((p) => [p.productId, p.price]));
  const unitsByProduct = new Map<string, typeof unitRows>();
  for (const unit of unitRows) {
    const list = unitsByProduct.get(unit.productId) ?? [];
    list.push(unit);
    unitsByProduct.set(unit.productId, list);
  }

  const promoByProduct = new Map<string, NonNullable<(typeof promoRows)[number]["tiers"]>>();
  for (const promo of promoRows) {
    if (isPromoActive(promo)) promoByProduct.set(promo.productId, promo.tiers ?? []);
  }

  return rawItems.map((item) => {
    const product = productById.get(item.productId);
    if (!product || !product.isActive) throw new Error("PRODUCT_NOT_FOUND");

    const unit =
      item.unitName === product.baseUnit
        ? null
        : unitsByProduct.get(product.id)?.find((u) => u.unitName === item.unitName) ?? undefined;
    if (unit === undefined) throw new Error("UNIT_NOT_FOUND");

    const multiplier = unit ? Number(unit.multiplier) : 1;
    const listedPrice = listedUnitPrice(product, unit, priceByProduct.get(product.id));
    const manualUnitPrice = item.manualUnitPrice;
    const lineDiscount = Math.max(0, item.lineDiscount ?? 0);
    const baseQty = item.quantity * multiplier;
    const promoPrice = manualUnitPrice == null
      ? applyPromo(listedPrice, promoByProduct.get(product.id), baseQty).price
      : listedPrice;
    const preDiscountUnitPrice = manualUnitPrice ?? promoPrice;
    const unitPrice = Math.max(0, preDiscountUnitPrice - lineDiscount);

    return {
      productId: product.id,
      productName: product.name,
      unitName: unit?.unitName ?? product.baseUnit,
      unitMultiplier: multiplier,
      quantity: item.quantity,
      preDiscountUnitPrice,
      lineDiscount,
      unitPrice,
      total: item.quantity * unitPrice,
    };
  });
}

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { products, productComboItems, productPrices, productUnits, promotions, priceBooks } from "@/db/schema";
import { canViewPurchasePrices, isInternalPriceBook, resolvePriceBookPrice, systemPriceBookType } from "@/lib/pricing/system-price-books";
import { applyPromo, isPromoActive } from "@/lib/promo";
import { resolveLinePriceEditor } from "@/lib/pos/line-price-editor";
import { lastPurchaseNetPriceSql } from "@/lib/pricing/last-purchase-net-price";
import type { CreateOrderOutput, UpdateOrderOutput } from "@/lib/schemas/order";

type RawOrderItem = CreateOrderOutput["items"][number] | UpdateOrderOutput["items"][number];

export type NormalizedOrderItem = {
  productId: string;
  productName: string;
  unitName: string;
  unitMultiplier: number;
  priceBookId: string | null;
  priceBookName: string;
  quantity: number;
  preDiscountUnitPrice: number;
  lineDiscount: number;
  lineDiscountMode: "pct" | "vnd";
  lineDiscountValue: number;
  unitPrice: number;
  total: number;
  productKind: "product" | "service" | "combo";
  stockItems: Array<{
    productId: string;
    quantity: number;
  }>;
};

function listedUnitPrice(
  product: { retailPrice: string },
  unit: { multiplier: string; priceOverride: string | null } | null,
  base: number,
  purchaseSource: boolean,
) {
  if (!unit) return base;
  if (!purchaseSource && unit.priceOverride != null) {
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
  storeId: string,
  rawItems: RawOrderItem[],
  invoicePriceBookId?: string | null,
  role?: string,
): Promise<NormalizedOrderItem[]> {
  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  if (productIds.length === 0) throw new Error("INVALID_ITEMS");
  const requestedPriceBookIds = [...new Set(rawItems
    .map((item) => item.priceBookId === undefined ? invoicePriceBookId : item.priceBookId)
    .filter((id): id is string => Boolean(id)))];

  const [productRows, unitRows, priceRows, priceBookRows, promoRows, comboRows] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        baseUnit: products.baseUnit,
        costPrice: products.costPrice,
        lastPurchasePrice: products.lastPurchasePrice,
        lastPurchaseNetPrice: lastPurchaseNetPriceSql(storeId),
        retailPrice: products.retailPrice,
        isActive: products.isActive,
        productKind: products.productKind,
      })
      .from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.id, productIds))),
    db
      .select({
        productId: productUnits.productId,
        unitName: productUnits.unitName,
        multiplier: productUnits.multiplier,
        priceOverride: productUnits.priceOverride,
      })
      .from(productUnits)
      .where(inArray(productUnits.productId, productIds)),
    requestedPriceBookIds.length > 0
      ? db
          .select({ priceBookId: productPrices.priceBookId, productId: productPrices.productId, price: productPrices.price })
          .from(productPrices)
          .where(and(eq(productPrices.storeId, storeId), inArray(productPrices.priceBookId, requestedPriceBookIds), inArray(productPrices.productId, productIds)))
      : Promise.resolve([]),
    requestedPriceBookIds.length > 0
      ? db
          .select({ id: priceBooks.id, name: priceBooks.name, costBased: priceBooks.costBased, systemType: priceBooks.systemType, isDefault: priceBooks.isDefault, managerOnly: priceBooks.managerOnly })
          .from(priceBooks)
          .where(and(eq(priceBooks.storeId, storeId), inArray(priceBooks.id, requestedPriceBookIds)))
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
    db
      .select({
        comboProductId: productComboItems.comboProductId,
        componentProductId: productComboItems.componentProductId,
        quantity: productComboItems.quantity,
        componentKind: products.productKind,
      })
      .from(productComboItems)
      .innerJoin(products, eq(productComboItems.componentProductId, products.id))
      .where(and(eq(productComboItems.storeId, storeId), inArray(productComboItems.comboProductId, productIds))),
  ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const priceByBookProduct = new Map(priceRows.map((p) => [`${p.priceBookId}:${p.productId}`, p.price]));
  const priceBookById = new Map(priceBookRows.map((book) => [book.id, book]));
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
  const comboItemsByProduct = new Map<string, typeof comboRows>();
  for (const comboItem of comboRows) {
    const list = comboItemsByProduct.get(comboItem.comboProductId) ?? [];
    list.push(comboItem);
    comboItemsByProduct.set(comboItem.comboProductId, list);
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
    const itemPriceBookId = item.priceBookId === undefined ? invoicePriceBookId ?? null : item.priceBookId;
    const itemPriceBook = itemPriceBookId ? priceBookById.get(itemPriceBookId) : undefined;
    if (itemPriceBookId && !itemPriceBook) throw new Error("PRICE_BOOK_NOT_FOUND");
    if (itemPriceBook && isInternalPriceBook(itemPriceBook) && !canViewPurchasePrices(role)) {
      throw new Error("PRICE_BOOK_FORBIDDEN");
    }
    const base = resolvePriceBookPrice(itemPriceBook ?? { isDefault: true }, product,
      itemPriceBookId ? priceByBookProduct.get(`${itemPriceBookId}:${product.id}`) : undefined);
    if (base == null) throw new Error("PRICE_BOOK_PRICE_UNAVAILABLE");
    const source = itemPriceBook ? systemPriceBookType(itemPriceBook) : "retail";
    const listedPrice = listedUnitPrice(product, unit, base, source === "cost" || source === "purchase" || source === "list");
    const manualUnitPrice = item.manualUnitPrice;
    const discountValue = Math.max(0, item.lineDiscountValue ?? item.lineDiscount ?? 0);
    const baseQty = item.quantity * multiplier;
    // Explicit customer discount replaces automatic promotions. Company list
    // prices never participate in automatic retail promotions.
    const promoPrice = manualUnitPrice == null && discountValue === 0 && source !== "list"
      ? applyPromo(listedPrice, promoByProduct.get(product.id), baseQty).price
      : listedPrice;
    const preDiscountUnitPrice = manualUnitPrice ?? promoPrice;
    const { lineDiscount, lineDiscountMode, lineDiscountValue, sellPrice: unitPrice } = resolveLinePriceEditor({
      price: String(preDiscountUnitPrice),
      discount: String(discountValue),
      discountMode: item.lineDiscountMode ?? "vnd",
      free: false,
    });

    return {
      productId: product.id,
      productName: product.name,
      unitName: unit?.unitName ?? product.baseUnit,
      unitMultiplier: multiplier,
      priceBookId: itemPriceBookId,
      priceBookName: itemPriceBook?.name ?? "Giá chung",
      quantity: item.quantity,
      preDiscountUnitPrice,
      lineDiscount,
      lineDiscountMode,
      lineDiscountValue,
      unitPrice,
      total: item.quantity * unitPrice,
      productKind: product.productKind,
      stockItems:
        product.productKind === "service"
          ? []
          : product.productKind === "combo"
            ? (comboItemsByProduct.get(product.id) ?? [])
                .filter((component) => component.componentKind === "product")
                .map((component) => ({
                  productId: component.componentProductId,
                  quantity: Number(component.quantity) * baseQty,
                }))
            : [{ productId: product.id, quantity: baseQty }],
    };
  });
}

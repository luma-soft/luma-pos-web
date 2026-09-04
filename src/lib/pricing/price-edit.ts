import { z } from "zod";
import { isPriceBookReadOnly, systemPriceBookType, type PriceBookSource } from "./system-price-books";

// Reject malformed/unknown filters: ignoring one could broaden a bulk mutation.
export const priceFormulaFiltersSchema = z.object({
  q: z.string().max(1000).optional(),
  categoryIds: z.array(z.uuid()).max(500).optional(),
  brandIds: z.array(z.uuid()).max(500).optional(),
  supplierIds: z.array(z.uuid()).max(500).optional(),
  stock: z.enum(["all", "negativeStock", "outOfStock", "lowStock", "inStock", "available", "unmanaged"]).optional(),
  productKind: z.enum(["all", "variant", "product", "service", "combo"]).optional(),
  lifecycle: z.enum(["all", "active", "paused", "draft", "archived"]).optional(),
  warehouseId: z.uuid().optional(),
}).strict();
export type PriceFormulaFilters = z.infer<typeof priceFormulaFiltersSchema>;
export type PriceUnit = { id?: string; unitName: string; multiplier: number; priceOverride: number | null };
export type PriceEditProduct = { baseUnit: string; retailPrice: number; units: PriceUnit[] };
export type UnitPriceMode = "keep" | "sync";
export const priceEditSnapshotSchema = z.object({
  baseUnit: z.string().min(1),
  retailPrice: z.number().finite().nonnegative(),
  basePrice: z.number().finite().nonnegative().nullable(),
  units: z.array(z.object({
    unitName: z.string().min(1), multiplier: z.number().finite().positive(), priceOverride: z.number().finite().nonnegative().nullable(),
  }).strict()).max(500),
}).strict();
export type PriceEditSnapshot = z.infer<typeof priceEditSnapshotSchema>;
export function priceEditSnapshot(product: PriceEditProduct, basePrice: number | null): PriceEditSnapshot {
  return { baseUnit: product.baseUnit, retailPrice: product.retailPrice, basePrice,
    units: product.units.map(({ unitName, multiplier, priceOverride }) => ({ unitName, multiplier, priceOverride: priceOverride ?? null })) };
}
export function matchesPriceEditSnapshot(expected: PriceEditSnapshot, actual: PriceEditSnapshot): boolean {
  const stable = (snapshot: PriceEditSnapshot) => JSON.stringify({ ...snapshot,
    units: [...snapshot.units].sort((a, b) => a.unitName.localeCompare(b.unitName)).map(({ unitName, multiplier, priceOverride }) => ({ unitName, multiplier, priceOverride })),
  });
  return stable(expected) === stable(actual);
}

// Calculate from decimal input, not a binary intermediate (20.15 × 50% is a
// half-cent tie that floating arithmetic can put below 10.075).
function fraction(value: number): [bigint, bigint] {
  if (!Number.isFinite(value)) throw new Error("errors.invalidData");
  const [coefficient, exponent = "0"] = String(value).split(/e/i);
  const places = (coefficient.split(".")[1]?.length ?? 0) - Number(exponent);
  const digits = BigInt(coefficient.replace(".", ""));
  return places >= 0 ? [digits, BigInt(10) ** BigInt(places)] : [digits * BigInt(10) ** BigInt(-places), BigInt(1)];
}
function roundMoney(numerator: bigint, denominator: bigint): number {
  const sign = numerator < BigInt(0) ? -1 : 1;
  const absolute = numerator < BigInt(0) ? -numerator : numerator;
  return sign * Number((absolute * BigInt(100) * BigInt(2) + denominator) / (denominator * BigInt(2))) / 100;
}
function ratioMoney(numerators: number[], denominators: number[] = []): number {
  let n = BigInt(1), d = BigInt(1);
  for (const value of numerators) { const [a, b] = fraction(value); n *= a; d *= b; }
  for (const value of denominators) { const [a, b] = fraction(value); n *= b; d *= a; }
  if (d <= BigInt(0)) throw new Error("errors.invalidData");
  return roundMoney(n, d);
}
export const priceMoney = (value: number) => ratioMoney([value]);

export function formulaPrice(base: number | null, op: "+" | "-", amount: number, unit: "vnd" | "pct") {
  if (base == null) return null;
  const [bn, bd] = fraction(base), [an, ad] = fraction(amount);
  const sign = BigInt(op === "-" ? -1 : 1);
  const n = unit === "pct" ? bn * (BigInt(100) * ad + sign * an) : bn * ad + sign * an * bd;
  const d = unit === "pct" ? bd * ad * BigInt(100) : bd * ad;
  return n < BigInt(0) ? 0 : roundMoney(n, d);
}

export function pricingUnitScale(product: PriceEditProduct, book: PriceBookSource, unit: PriceUnit): number | null {
  const source = systemPriceBookType(book);
  if (source == null && unit.priceOverride != null) {
    return product.retailPrice > 0 && unit.priceOverride > 0 ? unit.priceOverride / product.retailPrice : null;
  }
  return unit.multiplier;
}

export function pricingUnitPrice(product: PriceEditProduct, book: PriceBookSource, basePrice: number | null, unitName: string): number | null {
  const source = systemPriceBookType(book);
  const base = basePrice ?? (source == null ? product.retailPrice : null);
  if (base == null || unitName === product.baseUnit) return base;
  const unit = product.units.find((candidate) => candidate.unitName === unitName);
  if (!unit) return null;
  if (source === "retail" && unit.priceOverride != null) return unit.priceOverride;
  if (source == null && unit.priceOverride != null) return Math.round(unit.priceOverride * (product.retailPrice > 0 ? base / product.retailPrice : 1));
  return Math.round(base * unit.multiplier);
}

/** Same pure calculation for the confirmation preview and the transactional write. */
export function planPriceEdit(product: PriceEditProduct, book: PriceBookSource, currentBasePrice: number | null, price: number | null, unitName = product.baseUnit, mode: UnitPriceMode = "keep") {
  if (isPriceBookReadOnly(book) || (mode !== "keep" && mode !== "sync") || (price !== null && (!Number.isFinite(price) || price < 0))) throw new Error("errors.invalidData");
  // The edited amount itself is money: normalize before inverse conversion,
  // matching the mobile editor and the value acknowledged in the preview.
  price = price == null ? null : priceMoney(price);
  const source = systemPriceBookType(book);
  const unit = unitName === product.baseUnit ? undefined : product.units.find((candidate) => candidate.unitName === unitName);
  if (unitName !== product.baseUnit && !unit) throw new Error("errors.invalidData");
  if (unit && (!Number.isFinite(unit.multiplier) || unit.multiplier <= 0)) throw new Error("errors.invalidData");
  if (source !== "retail" && mode === "sync") throw new Error("errors.invalidData");
  if (source === "retail") {
    if ((!unit || mode === "sync") && price == null) throw new Error("errors.invalidData");
    if (mode === "sync") return {
      basePrice: ratioMoney([price!], [unit?.multiplier ?? 1]),
      units: product.units.map((candidate) => ({ ...candidate, priceOverride: null })),
    };
    return {
      basePrice: unit ? currentBasePrice : priceMoney(price!),
      units: product.units.map((candidate) => candidate === unit ? { ...candidate, priceOverride: price == null ? null : priceMoney(price) } : candidate),
    };
  }
  // Clearing a non-retail price affects the entire SKU/book, only exposed on base.
  if (unit && price == null) throw new Error("errors.invalidData");
  const scale = unit ? pricingUnitScale(product, book, unit) : 1;
  if (scale == null || !Number.isFinite(scale) || scale <= 0) throw new Error("errors.invalidData");
  const basePrice = price == null ? null
    : source == null && unit?.priceOverride != null
      ? ratioMoney([price, product.retailPrice], [unit.priceOverride])
      : ratioMoney([price], [unit?.multiplier ?? 1]);
  return { basePrice, units: product.units };
}

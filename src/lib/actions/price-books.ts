"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { priceBooks, productPrices, productUnits, products } from "@/db/schema";
import { type ActionResult, requireManager, toMoney } from "./common";
import { Routes } from "@/lib/routes";
import { isSystemPriceBook, isPriceBookReadOnly, isReservedPriceBookName } from "@/lib/pricing/system-price-books";
import { pricingFilterCondition, pricingSellableProductCondition } from "@/lib/data/pricing";
import { recordActivity } from "@/lib/audit/activity-log";
import { lastPurchaseNetPriceSql } from "@/lib/pricing/last-purchase-net-price";
import { planPriceEdit, priceFormulaFiltersSchema, type PriceFormulaFilters, type UnitPriceMode } from "@/lib/pricing/price-edit";

export type PriceFormulaBase = "current" | "cost" | "lastPurchase" | "list";

/** Biểu thức giá mới = base ± (số VND hoặc % của base), kẹp >= 0, làm tròn 2 chữ số. */
function priceExpr(base: SQL, op: "+" | "-", amount: number, unit: "vnd" | "pct"): SQL {
  const sign = op === "-" ? -1 : 1;
  const expr = unit === "pct"
    ? sql`${base} * ${1 + (sign * amount) / 100}`
    : sql`${base} + ${sign * amount}`;
  return sql`greatest(0, round((${expr})::numeric, 2))`;
}

/**
 * Áp công thức cho SKU đủ điều kiện trong bộ lọc, trên tất cả các trang.
 * Client cũ không gửi filters vẫn áp toàn danh mục như hợp đồng cũ.
 * base "current" = giá hiện tại của bảng (mặc định: retailPrice; bảng khác: override ?? retailPrice).
 * base "cost"    = giá vốn.
 */
export async function applyPriceFormulaAll(input: {
  priceBookId: string;
  base: PriceFormulaBase;
  op: "+" | "-";
  amount: number;
  unit: "vnd" | "pct";
  filters?: PriceFormulaFilters;
  unitPriceMode?: UnitPriceMode;
}): Promise<ActionResult<{ count: number }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const filters = priceFormulaFiltersSchema.safeParse(input.filters === undefined ? {} : input.filters);
  if (!filters.success || (input.unitPriceMode !== undefined && input.unitPriceMode !== "keep" && input.unitPriceMode !== "sync")) return { ok: false, error: "errors.invalidData" };
  if (!Number.isFinite(input.amount) || input.amount < 0 || !["current", "cost", "lastPurchase", "list"].includes(input.base) || !["+", "-"].includes(input.op) || !["vnd", "pct"].includes(input.unit)) return { ok: false, error: "errors.invalidData" };
  try {
    const result = await db.transaction(async (tx) => {
      const [book] = await tx.select({ name: priceBooks.name, isDefault: priceBooks.isDefault, systemType: priceBooks.systemType, costBased: priceBooks.costBased }).from(priceBooks).where(and(eq(priceBooks.storeId, gate.storeId), eq(priceBooks.id, input.priceBookId))).limit(1).for("no key update");
      if (!book) return null;
      if (isPriceBookReadOnly(book)) return "pricing.errors.systemReadOnly";
      if (input.unitPriceMode === "sync" && !book.isDefault) return "errors.invalidData";
      const currentPrice = sql`(select pp.price from product_prices pp where pp.store_id = ${gate.storeId}
        and pp.product_id = ${sql.raw('"products"."id"')} and pp.price_book_id = ${input.priceBookId} limit 1)`;
      const listPrice = sql`(select pp.price from product_prices pp join price_books pb on pb.id = pp.price_book_id and pb.store_id = pp.store_id
        where pp.store_id = ${gate.storeId} and pp.product_id = ${sql.raw('"products"."id"')} and pb.system_type = 'list' limit 1)`;
      const base = input.base === "cost" ? sql`${products.costPrice}`
        : input.base === "lastPurchase" ? lastPurchaseNetPriceSql(gate.storeId)
        : input.base === "list" ? listPrice
        : book.isDefault ? sql`${products.retailPrice}`
        : book.systemType === "list" ? currentPrice
        : sql`coalesce(${currentPrice}, ${products.retailPrice})`;
      const before = await tx.select({ id: products.id, name: products.name, sku: products.sku,
        retailPrice: products.retailPrice, basePrice: sql<string | null>`${base}`,
        previousPrice: sql<string | null>`${book.isDefault ? sql`${products.retailPrice}` : currentPrice}` })
        .from(products).where(and(pricingFilterCondition(gate.storeId, filters.data), pricingSellableProductCondition())).for("update");
      // A catalogue only applies to products with an explicit company price.
      // Never manufacture a price for missing/non-applicable SKUs.
      const applicable = before.filter((row) => row.basePrice != null);
      if (!applicable.length) return "pricing.errors.priceUnavailable";
      const target = and(eq(products.storeId, gate.storeId), inArray(products.id, applicable.map((row) => row.id)));
      if (book.isDefault) {
        await tx.update(products).set({ retailPrice: priceExpr(base, input.op, input.amount, input.unit), updatedAt: sql`now()` }).where(target);
      } else {
        await tx.insert(productPrices).select(tx.select({
          id: sql<string>`gen_random_uuid()`.as("id"), storeId: sql<string>`${gate.storeId}`.as("store_id"),
          priceBookId: sql<string>`${input.priceBookId}`.as("price_book_id"), productId: products.id,
          price: priceExpr(base, input.op, input.amount, input.unit).as("price"),
        }).from(products).where(target)).onConflictDoUpdate({
          target: [productPrices.priceBookId, productPrices.productId], set: { price: sql`excluded.price` },
        });
      }
      const clearedUnits = input.unitPriceMode === "sync"
        ? await tx.select({ id: productUnits.id, productId: productUnits.productId, unitName: productUnits.unitName, priceOverride: productUnits.priceOverride }).from(productUnits)
          .where(and(eq(productUnits.storeId, gate.storeId), inArray(productUnits.productId, applicable.map((row) => row.id)), sql`${productUnits.priceOverride} is not null`)).for("update")
        : [];
      if (clearedUnits.length) await tx.update(productUnits).set({ priceOverride: null })
        .where(and(eq(productUnits.storeId, gate.storeId), inArray(productUnits.id, clearedUnits.map((unit) => unit.id))));
      const after = book.isDefault
        ? await tx.select({ productId: products.id, price: products.retailPrice }).from(products).where(target)
        : await tx.select({ productId: productPrices.productId, price: productPrices.price }).from(productPrices)
          .where(and(eq(productPrices.storeId, gate.storeId), eq(productPrices.priceBookId, input.priceBookId), inArray(productPrices.productId, applicable.map((row) => row.id))));
      const next = new Map(after.map((row) => [row.productId, Number(row.price)]));
      const changes = applicable.flatMap((row) => {
        const previous = row.previousPrice == null ? null : Number(row.previousPrice);
        const price = next.get(row.id)!;
        return previous === price ? [] : [{ type: "product", id: row.id, code: row.sku, name: row.name, beforePrice: previous, price }];
      });
      if (changes.length || clearedUnits.length) await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "price_book.formula.applied", entityType: "price_book", entityId: input.priceBookId,
        after: { name: book.name, changedCount: changes.length }, affectedRecords: changes,
        metadata: { priceBookName: book.name, base: input.base, operator: input.op, amount: input.amount, unit: input.unit, filters: filters.data, unitPriceMode: input.unitPriceMode ?? "keep", clearedUnitOverrides: clearedUnits, skippedMissingPrices: before.length - applicable.length },
      });
      return applicable.length;
    });
    if (result == null) return { ok: false, error: "errors.invalidData" };
    if (typeof result === "string") return { ok: false, error: result };
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: { count: result } };
  } catch (e) { console.error("applyPriceFormulaAll failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Tạo bảng giá mới. */
export async function createPriceBook(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  if (isReservedPriceBookName(n)) return { ok: false, error: "pricing.errors.systemReadOnly" };
  try {
    const row = await db.transaction(async (tx) => {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${priceBooks.sortOrder}), 0)` }).from(priceBooks).where(eq(priceBooks.storeId, gate.storeId));
      const [row] = await tx.insert(priceBooks).values({ storeId: gate.storeId, name: n, sortOrder: Number(max) + 1 }).returning({ id: priceBooks.id, name: priceBooks.name });
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "price_book.created", entityType: "price_book", entityId: row.id, after: { name: row.name } });
      return row;
    });
    revalidatePath(Routes.Pricing);
    return { ok: true, data: row };
  } catch (e) { console.error("createPriceBook failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Đổi tên bảng giá. */
export async function renamePriceBook(id: string, name: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  if (isReservedPriceBookName(n)) return { ok: false, error: "pricing.errors.systemReadOnly" };
  try {
    const error = await db.transaction(async (tx) => {
      const [before] = await tx.select({ name: priceBooks.name, systemType: priceBooks.systemType, isDefault: priceBooks.isDefault, costBased: priceBooks.costBased }).from(priceBooks).where(and(eq(priceBooks.storeId, gate.storeId), eq(priceBooks.id, id))).limit(1).for("update");
      if (!before) return "errors.invalidData";
      if (isSystemPriceBook(before)) return "pricing.errors.systemReadOnly";
      if (before.name === n) return;
      await tx.update(priceBooks).set({ name: n }).where(and(eq(priceBooks.storeId, gate.storeId), eq(priceBooks.id, id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "price_book.renamed", entityType: "price_book", entityId: id, before, after: { name: n } });
    });
    if (error) return { ok: false, error };
    revalidatePath(Routes.Pricing);
    return { ok: true, data: undefined };
  } catch (e) { console.error("renamePriceBook failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Xóa bảng giá (không xóa bảng mặc định). Override theo bảng tự xóa (cascade). */
export async function deletePriceBook(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    const error = await db.transaction(async (tx) => {
      const [book] = await tx.select({ name: priceBooks.name, isDefault: priceBooks.isDefault, systemType: priceBooks.systemType, costBased: priceBooks.costBased }).from(priceBooks).where(and(eq(priceBooks.storeId, gate.storeId), eq(priceBooks.id, id))).limit(1).for("update");
      if (!book) return "errors.invalidData";
      if (isSystemPriceBook(book)) return "pricing.errors.systemReadOnly";
      await tx.delete(priceBooks).where(and(eq(priceBooks.storeId, gate.storeId), eq(priceBooks.id, id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "price_book.deleted", entityType: "price_book", entityId: id, before: { name: book.name } });
      return null;
    });
    if (error) return { ok: false, error };
    revalidatePath(Routes.Pricing);
    return { ok: true, data: undefined };
  } catch (e) { console.error("deletePriceBook failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/**
 * Đặt giá 1 SP trong 1 bảng giá.
 * - Bảng mặc định → cập nhật products.retailPrice.
 * - Bảng khác → upsert override; price=null → xóa override (về lại giá lẻ).
 */
export async function setProductPrice(input: {
  priceBookId: string;
  productId: string;
  price: number | null;
  unitName?: string;
  unitPriceMode?: UnitPriceMode;
}): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (input.price !== null && (!Number.isFinite(input.price) || input.price < 0)) return { ok: false, error: "errors.invalidData" };
  if ((input.unitName !== undefined && (typeof input.unitName !== "string" || !input.unitName.trim())) || (input.unitPriceMode !== undefined && input.unitPriceMode !== "keep" && input.unitPriceMode !== "sync")) return { ok: false, error: "errors.invalidData" };
  try {
    const result = await db.transaction(async (tx) => {
      const [book] = await tx.select({ name: priceBooks.name, isDefault: priceBooks.isDefault, systemType: priceBooks.systemType, costBased: priceBooks.costBased }).from(priceBooks).where(and(eq(priceBooks.storeId, gate.storeId), eq(priceBooks.id, input.priceBookId))).limit(1).for("no key update");
      if (!book) return false;
      if (isPriceBookReadOnly(book)) return "pricing.errors.systemReadOnly";
      const [product] = await tx.select({ name: products.name, sku: products.sku, retailPrice: products.retailPrice, baseUnit: products.baseUnit }).from(products)
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, input.productId))).limit(1).for("update");
      if (!product) return false;
      const units = (await tx.select({ id: productUnits.id, unitName: productUnits.unitName, multiplier: productUnits.multiplier, priceOverride: productUnits.priceOverride }).from(productUnits)
        .where(and(eq(productUnits.storeId, gate.storeId), eq(productUnits.productId, input.productId))).for("update"))
        .map((unit) => ({ ...unit, multiplier: Number(unit.multiplier), priceOverride: unit.priceOverride == null ? null : Number(unit.priceOverride) }));
      const [override] = book.isDefault ? [] : await tx.select({ price: productPrices.price }).from(productPrices)
        .where(and(eq(productPrices.storeId, gate.storeId), eq(productPrices.priceBookId, input.priceBookId), eq(productPrices.productId, input.productId))).limit(1);
      const beforePrice = book.isDefault ? Number(product.retailPrice) : override ? Number(override.price) : null;
      let planned;
      try {
        planned = planPriceEdit({ baseUnit: product.baseUnit, retailPrice: Number(product.retailPrice), units }, book, beforePrice, input.price, input.unitName, input.unitPriceMode);
      } catch { return "errors.invalidData"; }
      const afterPrice = planned.basePrice;
      const changedUnits = planned.units.filter((unit) => unit.priceOverride !== units.find((before) => before.id === unit.id)?.priceOverride);
      if (beforePrice === afterPrice && !changedUnits.length) return true;

      if (book.isDefault) {
        await tx.update(products).set({ retailPrice: toMoney(afterPrice!), updatedAt: sql`now()` }).where(and(eq(products.storeId, gate.storeId), eq(products.id, input.productId)));
      } else if (afterPrice == null) {
        await tx.delete(productPrices).where(and(eq(productPrices.storeId, gate.storeId), eq(productPrices.priceBookId, input.priceBookId), eq(productPrices.productId, input.productId)));
      } else {
        await tx.insert(productPrices)
          .values({ storeId: gate.storeId, priceBookId: input.priceBookId, productId: input.productId, price: toMoney(afterPrice) })
          .onConflictDoUpdate({
            target: [productPrices.priceBookId, productPrices.productId],
            set: { price: toMoney(afterPrice) },
          });
      }
      for (const unit of changedUnits) await tx.update(productUnits).set({ priceOverride: unit.priceOverride == null ? null : toMoney(unit.priceOverride) })
        .where(and(eq(productUnits.storeId, gate.storeId), eq(productUnits.productId, input.productId), eq(productUnits.id, unit.id!)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "product.price_book.updated", entityType: "product", entityId: input.productId,
        before: { name: product.name, sku: product.sku, price: beforePrice, units }, after: { name: product.name, sku: product.sku, price: afterPrice, units: planned.units },
        metadata: { productName: product.name, productSku: product.sku, priceBookId: input.priceBookId, priceBookName: book.name, unitName: input.unitName ?? product.baseUnit, unitPriceMode: input.unitPriceMode ?? "keep", usesRetailPrice: book.systemType !== "list" && afterPrice == null },
    });
    return true;
    });
    if (!result) return { ok: false, error: "errors.invalidData" };
    if (typeof result === "string") return { ok: false, error: result };
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) { console.error("setProductPrice failed:", e); return { ok: false, error: "errors.serverError" }; }
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { priceBooks, productPrices, products } from "@/db/schema";
import { type ActionResult, requireManager, toMoney } from "./common";
import { Routes } from "@/lib/routes";

export type PriceFormulaBase = "current" | "cost" | "lastPurchase";

/** Biểu thức giá mới = base ± (số VND hoặc % của base), kẹp >= 0, làm tròn 2 chữ số. */
function priceExpr(base: SQL, op: "+" | "-", amount: number, unit: "vnd" | "pct"): SQL {
  const sign = op === "-" ? -1 : 1;
  const expr = unit === "pct"
    ? sql`${base} * ${1 + (sign * amount) / 100}`
    : sql`${base} + ${sign * amount}`;
  return sql`greatest(0, round((${expr})::numeric, 2))`;
}

/**
 * Áp công thức đặt giá cho TẤT CẢ sản phẩm trong 1 bảng giá (giống KiotViet).
 * base "current" = giá hiện tại của bảng (mặc định: retailPrice; bảng khác: override ?? retailPrice).
 * base "cost"    = giá vốn.
 */
export async function applyPriceFormulaAll(input: {
  priceBookId: string;
  base: PriceFormulaBase;
  op: "+" | "-";
  amount: number;
  unit: "vnd" | "pct";
}): Promise<ActionResult<{ count: number }>> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    const [book] = await db.select({ isDefault: priceBooks.isDefault }).from(priceBooks).where(eq(priceBooks.id, input.priceBookId)).limit(1);
    if (!book) return { ok: false, error: "errors.invalidData" };

    if (book.isDefault) {
      const base = input.base === "cost" ? sql`${products.costPrice}`
        : input.base === "lastPurchase" ? sql`coalesce(${products.lastPurchasePrice}, ${products.costPrice})`
        : sql`${products.retailPrice}`;
      await db.update(products).set({ retailPrice: priceExpr(base, input.op, input.amount, input.unit), updatedAt: sql`now()` });
    } else {
      const base = input.base === "cost" ? sql`p.cost_price`
        : input.base === "lastPurchase" ? sql`coalesce(p.last_purchase_price, p.cost_price)`
        : sql`coalesce(pp.price, p.retail_price)`;
      await db.execute(sql`
        insert into product_prices (price_book_id, product_id, price)
        select ${input.priceBookId}, p.id, ${priceExpr(base, input.op, input.amount, input.unit)}
        from products p
        left join product_prices pp on pp.product_id = p.id and pp.price_book_id = ${input.priceBookId}
        on conflict (price_book_id, product_id) do update set price = excluded.price
      `);
    }

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products);
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: { count: Number(n) } };
  } catch (e) { console.error("applyPriceFormulaAll failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Tạo bảng giá mới. */
export async function createPriceBook(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${priceBooks.sortOrder}), 0)` }).from(priceBooks);
    const [row] = await db.insert(priceBooks).values({ name: n, sortOrder: Number(max) + 1 }).returning({ id: priceBooks.id, name: priceBooks.name });
    revalidatePath(Routes.Pricing);
    return { ok: true, data: row };
  } catch (e) { console.error("createPriceBook failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Đổi tên bảng giá. */
export async function renamePriceBook(id: string, name: string): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    await db.update(priceBooks).set({ name: n }).where(eq(priceBooks.id, id));
    revalidatePath(Routes.Pricing);
    return { ok: true, data: undefined };
  } catch (e) { console.error("renamePriceBook failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Xóa bảng giá (không xóa bảng mặc định). Override theo bảng tự xóa (cascade). */
export async function deletePriceBook(id: string): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    const [book] = await db.select({ isDefault: priceBooks.isDefault }).from(priceBooks).where(eq(priceBooks.id, id)).limit(1);
    if (!book) return { ok: false, error: "errors.invalidData" };
    if (book.isDefault) return { ok: false, error: "pricing.errors.cannotDeleteDefault" };
    await db.delete(priceBooks).where(eq(priceBooks.id, id));
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
}): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    const [book] = await db.select({ isDefault: priceBooks.isDefault }).from(priceBooks).where(eq(priceBooks.id, input.priceBookId)).limit(1);
    if (!book) return { ok: false, error: "errors.invalidData" };

    if (book.isDefault) {
      await db.update(products).set({ retailPrice: toMoney(Math.max(0, input.price ?? 0)), updatedAt: sql`now()` }).where(eq(products.id, input.productId));
    } else if (input.price == null) {
      await db.delete(productPrices).where(and(eq(productPrices.priceBookId, input.priceBookId), eq(productPrices.productId, input.productId)));
    } else {
      await db.insert(productPrices)
        .values({ priceBookId: input.priceBookId, productId: input.productId, price: toMoney(Math.max(0, input.price)) })
        .onConflictDoUpdate({
          target: [productPrices.priceBookId, productPrices.productId],
          set: { price: toMoney(Math.max(0, input.price)) },
        });
    }
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) { console.error("setProductPrice failed:", e); return { ok: false, error: "errors.serverError" }; }
}

"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, categories, stockLevels, stockMovements, warehouses } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { type ActionResult, requireStockAccess, getProfileId } from "./common";

/** 1 dòng CSV đã map sang field LumaPOS (tất cả là chuỗi thô). */
const importRowSchema = z.object({
  name: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  retailPrice: z.string().optional(),
  costPrice: z.string().optional(),
  stock: z.string().optional(),
});
const importInputSchema = z.array(importRowSchema).max(5000);
export type ImportRow = z.infer<typeof importRowSchema>;

export type ImportSummary = {
  total: number;
  toCreate: number;
  toUpdate: number;
  newCategories: string[];
  errors: { row: number; msg: string }[];
  applied: boolean;
  created: number;
  updated: number;
};

/** Chuỗi số kiểu VN/EN → number. "1.200.000" / "1,200,000" / "12.000,5" → number. */
function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // dấu xuất hiện sau cùng là dấu thập phân
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    // chỉ có dấu phẩy: 1 dấu → thập phân; nhiều → ngăn nghìn
    s = (s.match(/,/g)?.length ?? 0) === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Nhập sản phẩm từ CSV đã map. dryRun=true chỉ phân tích (không ghi).
 * - Khớp theo SKU: trùng → cập nhật, mới → tạo (sinh SKU nếu trống).
 * - Nhóm hàng theo tên: tìm hoặc tạo mới.
 * - Tồn kho (nếu có cột): ghi vào kho mặc định + movement (init/adjust).
 */
export async function importProducts(rows: unknown, dryRun: boolean): Promise<ActionResult<ImportSummary>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;

  const parsed = importInputSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  // Chuẩn hóa + validate từng dòng
  const clean = parsed.data.map((r) => ({
    name: r.name?.trim() ?? "",
    sku: r.sku?.trim() ?? "",
    barcode: r.barcode?.trim() ?? "",
    category: r.category?.trim() ?? "",
    unit: r.unit?.trim() ?? "",
    retailPrice: r.retailPrice,
    costPrice: r.costPrice,
    hasStock: r.stock != null && r.stock.trim() !== "",
    stock: r.stock,
  }));

  const errors: { row: number; msg: string }[] = [];
  const valid = clean.filter((r, i) => {
    if (!r.name) { errors.push({ row: i + 1, msg: "import.errors.noName" }); return false; }
    return true;
  });

  try {
    // SKU đã tồn tại → cập nhật
    const skus = [...new Set(valid.map((r) => r.sku).filter(Boolean))];
    const existing = skus.length
      ? await db.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.sku, skus))
      : [];
    const skuToId = new Map(existing.map((e) => [e.sku, e.id]));

    // Nhóm hàng có sẵn (theo tên, không phân biệt hoa thường)
    const allCats = await db.select({ id: categories.id, name: categories.name }).from(categories);
    const catByName = new Map(allCats.map((c) => [norm(c.name), c.id]));
    const wantedCats = [...new Set(valid.map((r) => r.category).filter(Boolean))];
    const newCategories = wantedCats.filter((c) => !catByName.has(norm(c)));

    const toUpdate = valid.filter((r) => r.sku && skuToId.has(r.sku)).length;
    const toCreate = valid.length - toUpdate;

    if (dryRun) {
      return { ok: true, data: { total: clean.length, toCreate, toUpdate, newCategories, errors, applied: false, created: 0, updated: 0 } };
    }

    const profileId = await getProfileId(gate.userId);
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(sql`${warehouses.isDefault} desc`).limit(1);

    let created = 0, updated = 0;
    await db.transaction(async (tx) => {
      // Tạo nhóm hàng còn thiếu
      for (const name of newCategories) {
        const [row] = await tx.insert(categories).values({ name: name.trim() }).returning({ id: categories.id });
        catByName.set(norm(name), row.id);
      }

      for (const r of valid) {
        const categoryId = r.category ? catByName.get(norm(r.category)) ?? null : null;
        const retail = parseNum(r.retailPrice);
        const cost = parseNum(r.costPrice);
        const stock = parseNum(r.stock);

        const existingId = r.sku ? skuToId.get(r.sku) : undefined;
        let productId: string;

        if (existingId) {
          await tx.update(products).set({
            name: r.name,
            barcode: r.barcode || null,
            ...(categoryId ? { categoryId } : {}),
            ...(r.unit ? { baseUnit: r.unit } : {}),
            retailPrice: String(retail),
            costPrice: String(cost),
            updatedAt: sql`now()`,
          }).where(eq(products.id, existingId));
          productId = existingId;
          updated++;
        } else {
          const sku = r.sku || `SP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
          const [row] = await tx.insert(products).values({
            sku, barcode: r.barcode || null, name: r.name, categoryId,
            baseUnit: r.unit || "cái", costPrice: String(cost), retailPrice: String(retail), isActive: true,
          }).returning({ id: products.id });
          productId = row.id;
          if (r.sku) skuToId.set(r.sku, productId); // tránh tạo trùng trong cùng file
          created++;
        }

        // Tồn kho (chỉ khi có cột stock + có kho mặc định)
        if (r.hasStock && wh) {
          const [cur] = await tx.select({ q: stockLevels.quantity }).from(stockLevels)
            .where(sql`${stockLevels.productId} = ${productId} and ${stockLevels.warehouseId} = ${wh.id}`).limit(1);
          const before = cur ? Number(cur.q) : 0;
          const delta = stock - before;
          await tx.insert(stockLevels).values({ productId, warehouseId: wh.id, quantity: String(stock) })
            .onConflictDoUpdate({ target: [stockLevels.productId, stockLevels.warehouseId], set: { quantity: String(stock), updatedAt: sql`now()` } });
          if (delta !== 0) {
            await tx.insert(stockMovements).values({
              productId, warehouseId: wh.id,
              type: existingId ? "adjust" : "init",
              quantity: String(delta), unitCost: String(cost),
              refType: "import", refId: productId, note: "Nhập từ file", createdBy: profileId,
            });
          }
        }
      }
    });

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    return { ok: true, data: { total: clean.length, toCreate, toUpdate, newCategories, errors, applied: true, created, updated } };
  } catch (e) {
    console.error("importProducts failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

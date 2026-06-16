"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  products, productUnits, productSuppliers, categories, brands, stockLevels, stockMovements, warehouses, profiles,
} from "@/db/schema";
import { createProductSchema, type CreateProductOutput } from "@/app/(app)/products/new/schema";
import { Routes } from "@/lib/routes";
import { requireStockAccess, requireManager } from "./common";

/** Tạo nhóm hàng mới từ form (combobox "+ thêm"). Trả id. */
export async function createCategory(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [row] = await db.insert(categories).values({ name: n }).returning({ id: categories.id, name: categories.name });
    revalidatePath(Routes.Products);
    return { ok: true, data: row };
  } catch (e) { console.error("createCategory failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Tạo nhóm hàng có nhóm cha (trang quản lý danh mục). */
export async function createCategoryNode(input: { name: string; parentId?: string | null }): Promise<ActionResult<{ id: string }>> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  const n = input.name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [row] = await db.insert(categories).values({ name: n, parentId: input.parentId || null }).returning({ id: categories.id });
    revalidatePath(Routes.Categories);
    revalidatePath(Routes.Products);
    return { ok: true, data: row };
  } catch (e) { console.error("createCategoryNode failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Đổi tên / đổi nhóm cha của danh mục. */
export async function updateCategory(id: string, input: { name?: string; parentId?: string | null }): Promise<ActionResult> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  const patch: { name?: string; parentId?: string | null } = {};
  if (input.name !== undefined) { const n = input.name.trim(); if (!n) return { ok: false, error: "errors.invalidData" }; patch.name = n; }
  if (input.parentId !== undefined) patch.parentId = input.parentId === id ? null : (input.parentId || null);
  try {
    await db.update(categories).set(patch).where(eq(categories.id, id));
    revalidatePath(Routes.Categories);
    revalidatePath(Routes.Products);
    return { ok: true, data: undefined };
  } catch (e) { console.error("updateCategory failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Xóa danh mục: SP về "chưa phân loại", nhóm con lên cấp gốc. */
export async function deleteCategory(id: string): Promise<ActionResult> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  try {
    await db.update(products).set({ categoryId: null }).where(eq(products.categoryId, id));
    await db.update(categories).set({ parentId: null }).where(eq(categories.parentId, id));
    await db.delete(categories).where(eq(categories.id, id));
    revalidatePath(Routes.Categories);
    revalidatePath(Routes.Products);
    return { ok: true, data: undefined };
  } catch (e) { console.error("deleteCategory failed:", e); return { ok: false, error: "errors.serverError" }; }
}

/** Tạo thương hiệu mới từ form. Trả id. */
export async function createBrand(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [existing] = await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.name, n)).limit(1);
    if (existing) return { ok: true, data: existing };
    const [row] = await db.insert(brands).values({ name: n }).returning({ id: brands.id, name: brands.name });
    revalidatePath(Routes.Products);
    return { ok: true, data: row };
  } catch (e) { console.error("createBrand failed:", e); return { ok: false, error: "errors.serverError" }; }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Generates a SKU like SP4F2K9Z1 when the user leaves it blank. */
function generateSku() {
  return `SP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function buildDimensions(v: CreateProductOutput): string | null {
  const parts = [v.width, v.length, v.thickness].filter((n): n is number => n != null && n > 0);
  if (parts.length === 0) return null;
  return `${parts.join("×")}${v.dimUnit}`;
}

/** m²/base-unit từ kích thước (gạch): width × length, đổi về mét. */
function computeM2PerUnit(v: CreateProductOutput): string | null {
  if (v.width == null || v.length == null || v.width <= 0 || v.length <= 0) return null;
  const factor = v.dimUnit === "mm" ? 0.001 : v.dimUnit === "cm" ? 0.01 : 1;
  const m2 = v.width * factor * (v.length * factor);
  return m2 > 0 ? m2.toFixed(4) : null;
}

const updatePricesSchema = z.object({
  productId: z.uuid(),
  retailPrice: z.number().min(0),
  wholesalePrice: z.number().min(0).nullable(),
  contractorPrice: z.number().min(0).nullable(),
  agentPrice: z.number().min(0).nullable(),
});
export type UpdatePricesInput = z.input<typeof updatePricesSchema>;

/** Thiết lập giá: cập nhật 4 bảng giá của 1 SP (trang /pricing). */
export async function updateProductPrices(input: UpdatePricesInput): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = updatePricesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    await db.update(products).set({
      retailPrice: String(v.retailPrice),
      wholesalePrice: v.wholesalePrice != null ? String(v.wholesalePrice) : null,
      contractorPrice: v.contractorPrice != null ? String(v.contractorPrice) : null,
      agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
      updatedAt: sql`now()`,
    }).where(eq(products.id, v.productId));

    revalidatePath("/pricing");
    revalidatePath(Routes.Products);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateProductPrices failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

const updateProductSchema = z.object({
  id: z.uuid(),
  sku: z.string().trim().min(1),
  barcode: z.string().trim().optional(),
  name: z.string().trim().min(1),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  supplierIds: z.array(z.string()).optional(), // không gửi → giữ nguyên NCC hiện có
  baseUnit: z.string().trim().min(1),
  costPrice: z.number().min(0),
  retailPrice: z.number().min(0),
  wholesalePrice: z.number().min(0).nullable(),
  contractorPrice: z.number().min(0).nullable(),
  agentPrice: z.number().min(0).nullable(),
  location: z.string().trim().optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean(),
  specs: z.record(z.string(), z.array(z.string())).nullable(),
  units: z.array(z.object({
    unitName: z.string().trim().min(1),
    multiplier: z.number().positive(),
    barcode: z.string().trim().optional(),
    priceOverride: z.number().min(0).nullable(),
  })),
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

/** Cập nhật thông tin SP (không đụng tồn kho — tồn quản lý ở Kho/Kiểm kho). */
export async function updateProduct(input: UpdateProductInput): Promise<ActionResult> {
  { const gate = await requireStockAccess(); if (!gate.ok) return gate; }
  try {
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      await tx.update(products).set({
        sku: v.sku,
        barcode: v.barcode || null,
        name: v.name,
        categoryId: v.categoryId || null,
        brandId: v.brandId || null,
        ...(v.supplierIds ? { supplierId: v.supplierIds[0] || null } : {}),
        baseUnit: v.baseUnit,
        costPrice: String(v.costPrice),
        retailPrice: String(v.retailPrice),
        wholesalePrice: v.wholesalePrice != null ? String(v.wholesalePrice) : null,
        contractorPrice: v.contractorPrice != null ? String(v.contractorPrice) : null,
        agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
        location: v.location || null,
        description: v.description || null,
        specs: v.specs && Object.keys(v.specs).length > 0 ? v.specs : null,
        isActive: v.isActive,
        updatedAt: sql`now()`,
      }).where(eq(products.id, v.id));

      // thay toàn bộ đơn vị quy đổi
      await tx.delete(productUnits).where(eq(productUnits.productId, v.id));
      const valid = v.units.filter((u) => u.unitName && u.multiplier > 0);
      if (valid.length > 0) {
        await tx.insert(productUnits).values(valid.map((u, i) => ({
          productId: v.id,
          unitName: u.unitName,
          multiplier: String(u.multiplier),
          barcode: u.barcode || null,
          priceOverride: u.priceOverride != null ? String(u.priceOverride) : null,
          sortOrder: i,
        })));
      }

      // NCC do nhập hàng tự gắn — chỉ đồng bộ khi form gửi supplierIds
      if (v.supplierIds) {
        await tx.delete(productSuppliers).where(eq(productSuppliers.productId, v.id));
        const sids = [...new Set(v.supplierIds.filter(Boolean))];
        if (sids.length > 0) {
          await tx.insert(productSuppliers).values(
            sids.map((sid, i) => ({ productId: v.id, supplierId: sid, isPrimary: i === 0 }))
          );
        }
      }
    });

    revalidatePath(Routes.Products);
    revalidatePath(`/products/${v.id}`);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === "23505") return { ok: false, error: "products.errors.skuExists" };
    console.error("updateProduct failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function createProduct(
  input: CreateProductOutput
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "errors.invalidData" };
  }
  const v = parsed.data;

  const sku = v.sku?.trim() || generateSku();
  const weightKg = v.weight != null ? (v.weightUnit === "g" ? v.weight / 1000 : v.weight) : null;
  const specs =
    v.attributes.length > 0
      ? Object.fromEntries(v.attributes.filter((a) => a.name.trim()).map((a) => [a.name, a.values]))
      : null;

  try {
    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          sku,
          barcode: v.barcode?.trim() || null,
          name: v.name.trim(),
          description: v.description || null,
          categoryId: v.categoryId || null,
          brandId: v.brandId || null,
          supplierId: v.supplierIds[0] || null, // NCC chính = phần tử đầu
          baseUnit: v.baseUnit || "cái",
          costPrice: String(v.costPrice),
          retailPrice: String(v.retailPrice),
          wholesalePrice: v.wholesalePrice != null ? String(v.wholesalePrice) : null,
          contractorPrice: v.contractorPrice != null ? String(v.contractorPrice) : null,
          agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
          m2PerUnit: computeM2PerUnit(v),
          location: v.location?.trim() || null,
          weight: weightKg != null ? String(weightKg) : null,
          dimensions: buildDimensions(v),
          specs,
          imageUrls: v.imageUrls,
          isActive: v.directSale,
        })
        .returning({ id: products.id });

      const validUnits = v.units.filter((u) => u.unitName.trim() && u.multiplier > 0);
      if (validUnits.length > 0) {
        await tx.insert(productUnits).values(
          validUnits.map((u, i) => ({
            productId: product.id,
            unitName: u.unitName.trim(),
            multiplier: String(u.multiplier),
            barcode: u.barcode?.trim() || null,
            priceOverride: u.priceOverride != null ? String(u.priceOverride) : null,
            sortOrder: i,
          }))
        );
      }

      // Nhiều nhà cung cấp (phần tử đầu = NCC chính)
      const supplierIds = [...new Set(v.supplierIds.filter(Boolean))];
      if (supplierIds.length > 0) {
        await tx.insert(productSuppliers).values(
          supplierIds.map((sid, i) => ({ productId: product.id, supplierId: sid, isPrimary: i === 0 }))
        );
      }

      // Tồn kho ban đầu vào kho mặc định
      const [defaultWh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.isDefault, true))
        .limit(1);

      if (defaultWh) {
        await tx.insert(stockLevels).values({
          productId: product.id,
          warehouseId: defaultWh.id,
          quantity: String(v.initialStock),
          minLevel: String(v.minLevel),
        });

        if (v.initialStock > 0) {
          const [profile] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

          await tx.insert(stockMovements).values({
            productId: product.id,
            warehouseId: defaultWh.id,
            type: "init",
            quantity: String(v.initialStock),
            unitCost: String(v.costPrice),
            refType: "product_init",
            refId: product.id,
            note: "Tồn đầu khi tạo sản phẩm",
            createdBy: profile?.id ?? null,
          });
        }
      }

      return product;
    });

    revalidatePath(Routes.Products);
    return { ok: true, data: { id: result.id } };
  } catch (e) {
    // Drizzle bọc lỗi PG vào DrizzleQueryError — lỗi gốc nằm ở e.cause
    const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
    const msg = e instanceof Error ? e.message : "";
    if (
      cause?.code === "23505" || // unique_violation
      cause?.constraint_name?.includes("sku") ||
      msg.includes("duplicate key")
    ) {
      return { ok: false, error: "products.errors.skuExists" };
    }
    console.error("createProduct failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

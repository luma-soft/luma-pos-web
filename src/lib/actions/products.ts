"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  products,
  productUnits,
  productComboItems,
  productSuppliers,
  categories,
  brands,
  stockLevels,
  stockMovements,
  warehouses,
  profiles,
  priceBooks,
  productPrices,
} from "@/db/schema";
import {
  createProductSchema,
  productUnitSchema,
  siblingApplySchema,
  type CreateProductOutput,
} from "@/app/(app)/products/new/schema";
import { Routes } from "@/lib/routes";
import {
  pgErrorCode,
  requireStockAccess,
  requireManager,
  requireFeatureRole,
  toMoney,
  getProfileId,
} from "./common";
import { productStockAdjustmentSchema } from "@/lib/products/stock-adjustment";
import { applyProductStockAdjustment } from "@/lib/products/product-stock-adjustment";
import { syncProductUnits } from "@/lib/products/product-unit-sync";
import { getPublicMediaConfig } from "@/lib/media/config";
import {
  externalProductImageUrls,
  ProductMediaValidationError,
  replaceProductMediaInTransaction,
  resolveLegacyProductImageIdsInTransaction,
} from "@/lib/products/product-media";
import { imageMediaIdsSchema } from "@/lib/products/product-media-schema";
import { recordActivity } from "@/lib/audit/activity-log";
import { activityValuesEqual, productActivityChanges, readProductActivitySnapshot } from "@/lib/products/product-activity";
import { saveProductVariantGroup } from "./product-variants";
import { variantNameKey } from "@/lib/products/variant-model";

/** Tạo nhóm hàng mới từ form (combobox "+ thêm"). Trả id. */
export async function createCategory(
  name: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({ storeId: gate.storeId, name: n })
        .returning({ id: categories.id, name: categories.name });
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "category.created", entityType: "category", entityId: row.id, after: { name: row.name } });
      return row;
    });
    revalidatePath(Routes.Products);
    return { ok: true, data: row };
  } catch (e) {
    console.error("createCategory failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Tạo nhóm hàng có nhóm cha (trang quản lý danh mục). */
export async function createCategoryNode(input: {
  name: string;
  parentId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const n = input.name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({ storeId: gate.storeId, name: n, parentId: input.parentId || null })
        .returning({ id: categories.id });
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "category.created", entityType: "category", entityId: row.id, after: { name: n, parentId: input.parentId || null } });
      return row;
    });
    revalidatePath(Routes.Categories);
    revalidatePath(Routes.Products);
    return { ok: true, data: row };
  } catch (e) {
    console.error("createCategoryNode failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Đổi tên / đổi nhóm cha của danh mục. */
export async function updateCategory(
  id: string,
  input: { name?: string; parentId?: string | null },
): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const patch: { name?: string; parentId?: string | null } = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "errors.invalidData" };
    patch.name = n;
  }
  if (input.parentId !== undefined)
    patch.parentId = input.parentId === id ? null : input.parentId || null;
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select({ name: categories.name, parentId: categories.parentId }).from(categories)
        .where(and(eq(categories.storeId, gate.storeId), eq(categories.id, id))).limit(1).for("update");
      if (!before || activityValuesEqual(before, { ...before, ...patch })) return;
      await tx.update(categories).set(patch).where(and(eq(categories.storeId, gate.storeId), eq(categories.id, id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "category.updated", entityType: "category", entityId: id, before, after: { ...before, ...patch } });
    });
    revalidatePath(Routes.Categories);
    revalidatePath(Routes.Products);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateCategory failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Xóa danh mục: SP về "chưa phân loại", nhóm con lên cấp gốc. */
export async function deleteCategory(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select({ name: categories.name }).from(categories)
        .where(and(eq(categories.storeId, gate.storeId), eq(categories.id, id))).limit(1).for("update");
      if (!before) return;
      await tx
        .update(products)
        .set({ categoryId: null })
        .where(and(eq(products.storeId, gate.storeId), eq(products.categoryId, id)));
      await tx
        .update(categories)
        .set({ parentId: null })
        .where(and(eq(categories.storeId, gate.storeId), eq(categories.parentId, id)));
      await tx.delete(categories).where(and(eq(categories.storeId, gate.storeId), eq(categories.id, id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "category.deleted", entityType: "category", entityId: id, before });
    });
    revalidatePath(Routes.Categories);
    revalidatePath(Routes.Products);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deleteCategory failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Tạo thương hiệu mới từ form. Trả id. */
export async function createBrand(
  name: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [existing] = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(and(eq(brands.storeId, gate.storeId), eq(brands.name, n)))
      .limit(1);
    if (existing) return { ok: true, data: existing };
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(brands)
        .values({ storeId: gate.storeId, name: n })
        .returning({ id: brands.id, name: brands.name });
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "brand.created", entityType: "brand", entityId: row.id, after: { name: row.name } });
      return row;
    });
    revalidatePath(Routes.Products);
    return { ok: true, data: row };
  } catch (e) {
    console.error("createBrand failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Generates a SKU like SP4F2K9Z1 when the user leaves it blank. */
function generateSku() {
  return `SP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function generateVariantSku(parentSku: string, index: number) {
  return `${parentSku}-${String(index + 1).padStart(2, "0")}`;
}

function childProductName(parentName: string, variantName: string) {
  return `${parentName.trim()} - ${variantName.trim()}`;
}

function baseNameFromChildName(name: string, variantName: string | null) {
  if (!variantName) return name.trim();
  const suffix = ` - ${variantName}`;
  return name.endsWith(suffix)
    ? name.slice(0, -suffix.length).trim()
    : name.trim();
}

function specsFromAttributes(
  attributes: CreateProductOutput["attributes"],
  options: { includeVariantAttributes?: boolean } = {},
) {
  const entries = attributes
    .filter(
      (a) =>
        a.name.trim() &&
        (options.includeVariantAttributes || !a.createsVariants),
    )
    .map((a) => [a.name.trim(), a.values] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

const PRODUCT_ORDER_NOTE_SPEC_KEY = "__orderNote";

function specsWithOrderNote(
  specs: Record<string, string[]> | null,
  invoiceNote: string | null | undefined,
) {
  const note = invoiceNote?.trim();
  const next = { ...(specs ?? {}) };
  if (note) next[PRODUCT_ORDER_NOTE_SPEC_KEY] = [note];
  else delete next[PRODUCT_ORDER_NOTE_SPEC_KEY];
  return Object.keys(next).length > 0 ? next : null;
}

function mergeSpecs(
  base: Record<string, string[]> | null,
  extra: Record<string, string[]> | null | undefined,
) {
  const merged = { ...(base ?? {}), ...(extra ?? {}) };
  return Object.keys(merged).length > 0 ? merged : null;
}

function buildDimensions(v: CreateProductOutput): string | null {
  const parts = [v.width, v.length, v.thickness].filter(
    (n): n is number => n != null && n > 0,
  );
  if (parts.length === 0) return null;
  return `${parts.join("×")}${v.dimUnit}`;
}

async function syncProductPriceBookPrices(
  storeId: string,
  productId: string,
  input: Record<string, number | null | undefined> | undefined,
  connection: Pick<typeof db, "select" | "delete" | "insert"> = db,
) {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return;

  const bookIds = [...new Set(entries.map(([id]) => id).filter(Boolean))];
  if (bookIds.length === 0) return;

  const validBooks = await connection
    .select({ id: priceBooks.id, isDefault: priceBooks.isDefault, systemType: priceBooks.systemType, costBased: priceBooks.costBased })
    .from(priceBooks)
    .where(and(eq(priceBooks.storeId, storeId), inArray(priceBooks.id, bookIds)));
  const nonDefaultIds = new Set(
    validBooks.filter((book) => !book.isDefault && !book.systemType && !book.costBased).map((book) => book.id),
  );

  const toDelete = entries
    .filter(([bookId, price]) => nonDefaultIds.has(bookId) && price == null)
    .map(([bookId]) => bookId);
  if (toDelete.length > 0) {
    await connection
      .delete(productPrices)
      .where(
        and(
          eq(productPrices.productId, productId),
          eq(productPrices.storeId, storeId),
          inArray(productPrices.priceBookId, toDelete),
        ),
      );
  }

  const toUpsert = entries
    .filter(([bookId, price]) => nonDefaultIds.has(bookId) && price != null)
    .map(([bookId, price]) => ({
      storeId,
      priceBookId: bookId,
      productId,
      price: toMoney(Math.max(0, Number(price))),
    }));
  if (toUpsert.length > 0) {
    await connection
      .insert(productPrices)
      .values(toUpsert)
      .onConflictDoUpdate({
        target: [productPrices.priceBookId, productPrices.productId],
        set: { price: sql`excluded.price` },
      });
  }
}

/** m²/base-unit từ kích thước (gạch): width × length, đổi về mét. */
function computeM2PerUnit(v: CreateProductOutput): string | null {
  if (v.width == null || v.length == null || v.width <= 0 || v.length <= 0)
    return null;
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
export async function updateProductPrices(
  input: UpdatePricesInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = updatePricesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select({ name: products.name, sku: products.sku, retailPrice: products.retailPrice, wholesalePrice: products.wholesalePrice, contractorPrice: products.contractorPrice, agentPrice: products.agentPrice })
        .from(products).where(and(eq(products.storeId, gate.storeId), eq(products.id, v.productId))).limit(1).for("update");
      if (!before) return;
      const previous = { name: before.name, sku: before.sku, retailPrice: Number(before.retailPrice), wholesalePrice: before.wholesalePrice == null ? null : Number(before.wholesalePrice), contractorPrice: before.contractorPrice == null ? null : Number(before.contractorPrice), agentPrice: before.agentPrice == null ? null : Number(before.agentPrice) };
      const after = { name: before.name, sku: before.sku, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, contractorPrice: v.contractorPrice, agentPrice: v.agentPrice };
      if (activityValuesEqual(previous, after)) return;
      await tx
        .update(products)
        .set({
          retailPrice: String(v.retailPrice),
          wholesalePrice:
            v.wholesalePrice != null ? String(v.wholesalePrice) : null,
          contractorPrice:
            v.contractorPrice != null ? String(v.contractorPrice) : null,
          agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, v.productId)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "product.prices.updated", entityType: "product", entityId: v.productId, before: previous, after });
    });

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
  stockAdjustment: productStockAdjustmentSchema.optional(),
  productKind: z.enum(["product", "service", "combo"]).optional(),
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
  vatRate: z.number().min(0).max(100).nullable().optional(),
  priceByWeight: z.boolean().optional(),
  trackBatches: z.boolean().optional(),
  shelfLifeDays: z.number().int().positive().nullable().optional(),
  lifecycleStatus: z.enum(["draft", "active", "archived"]).optional(),
  priceBookPrices: z
    .record(z.string(), z.number().min(0).nullable())
    .default({}),
  location: z.string().trim().optional(),
  description: z.string().trim().optional(),
  imageUrls: z.array(z.string()).optional(),
  imageMediaIds: imageMediaIdsSchema.optional(),
  comboItems: z.array(z.object({
    productId: z.uuid(),
    quantity: z.number().positive(),
  })).optional(),
  isActive: z.boolean(),
  specs: z.record(z.string(), z.array(z.string())).nullable(),
  applyToSiblings: siblingApplySchema.optional(),
  units: z.array(productUnitSchema),
}).superRefine((value, ctx) => {
  if (
    value.productKind === "combo" &&
    (!value.comboItems || value.comboItems.length === 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["comboItems"],
      message: "products.combo.itemsRequired",
    });
  }
  if (value.comboItems?.some((item) => item.productId === value.id)) {
    ctx.addIssue({
      code: "custom",
      path: ["comboItems"],
      message: "products.errors.comboCannotContainItself",
    });
  }
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

const productIdSchema = z.uuid();

/** Xóa hàng hóa nếu chưa phát sinh chứng từ/thẻ kho liên quan. */
export async function deleteProduct(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = productIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: products.id, name: products.name, sku: products.sku, isVariantParent: products.isVariantParent })
        .from(products)
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, parsed.data)))
        .limit(1).for("update");
      if (!target) return;

      if (target.isVariantParent) {
        await tx
          .delete(products)
          .where(and(eq(products.storeId, gate.storeId), eq(products.parentProductId, target.id)));
      }
      await tx.delete(products).where(and(eq(products.storeId, gate.storeId), eq(products.id, target.id)));
      await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "product.deleted", entityType: "product", entityId: target.id, before: { name: target.name, sku: target.sku }, metadata: { includesVariants: target.isVariantParent } });
    });
    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    if (pgErrorCode(e) === "23503")
      return { ok: false, error: "products.errors.cannotDeleteReferenced" };
    console.error("deleteProduct failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

const setProductActiveSchema = z.object({
  productId: z.uuid(),
  isActive: z.boolean(),
});
const bulkProductIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]);

/** Bật/tắt kinh doanh. Với nhóm biến thể, áp dụng cho cả nhóm con. */
export async function setProductActive(
  input: z.input<typeof setProductActiveSchema>,
): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = setProductActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const updated = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: products.id, name: products.name, sku: products.sku, isVariantParent: products.isVariantParent })
        .from(products)
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, v.productId)))
        .limit(1);
      if (!target) return false;
      const condition = and(eq(products.storeId, gate.storeId), target.isVariantParent
        ? or(eq(products.id, target.id), eq(products.parentProductId, target.id))
        : eq(products.id, target.id));
      const before = await tx.select({ id: products.id, name: products.name, code: products.sku, isActive: products.isActive, lifecycleStatus: products.lifecycleStatus })
        .from(products).where(condition).for("update");
      const changes = before.filter((row) => row.isActive !== v.isActive || row.lifecycleStatus !== (v.isActive ? "active" : "archived"));

      await tx
        .update(products)
        .set({
          isActive: v.isActive,
          lifecycleStatus: v.isActive ? "active" : "archived",
          updatedAt: sql`now()`,
        })
        .where(and(
          eq(products.storeId, gate.storeId),
          target.isVariantParent
            ? or(
                eq(products.id, target.id),
                eq(products.parentProductId, target.id),
              )
            : eq(products.id, target.id),
        ));
      if (changes.length) await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "product.status.changed", entityType: "product", entityId: target.id,
        before: { name: target.name, sku: target.sku, products: changes },
        after: { name: target.name, sku: target.sku, isActive: v.isActive, lifecycleStatus: v.isActive ? "active" : "archived" },
        affectedRecords: changes.map((row) => ({ type: "product", id: row.id, code: row.code, name: row.name })),
    });
    return true;
    });
    if (!updated) return { ok: false, error: "errors.invalidData" };

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.POS);
    revalidatePath(`/products/${v.productId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setProductActive failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Ngừng kinh doanh nhiều hàng hóa; nhóm biến thể áp dụng cho cả sản phẩm con. */
export async function bulkStopSellingProducts(
  ids: string[],
): Promise<ActionResult<{ updated: number }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = bulkProductIdsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  try {
    const updated = await db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: products.id, isVariantParent: products.isVariantParent })
        .from(products)
        .where(and(eq(products.storeId, gate.storeId), inArray(products.id, parsed.data)));
      const parentIds = targets
        .filter((target) => target.isVariantParent)
        .map((target) => target.id);
      const conditions = [inArray(products.id, parsed.data)];
      if (parentIds.length > 0) {
        conditions.push(inArray(products.parentProductId, parentIds));
      }
      const before = await tx.select({ id: products.id, name: products.name, code: products.sku, isActive: products.isActive, lifecycleStatus: products.lifecycleStatus })
        .from(products).where(and(eq(products.storeId, gate.storeId), or(...conditions))).for("update");
      const changes = before.filter((row) => row.isActive || row.lifecycleStatus !== "archived");
      const updated = await tx
        .update(products)
        .set({
          isActive: false,
          lifecycleStatus: "archived",
          updatedAt: sql`now()`,
        })
        .where(and(eq(products.storeId, gate.storeId), or(...conditions)))
        .returning({ id: products.id });
      if (changes.length) await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "product.bulk.stopped", entityType: "product",
        before: { products: changes }, after: { isActive: false, lifecycleStatus: "archived", changedCount: changes.length },
        affectedRecords: changes.map((row) => ({ type: "product", id: row.id, code: row.code, name: row.name })),
    });
    return updated;
    });

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.POS);
    return { ok: true, data: { updated: updated.length } };
  } catch (e) {
    console.error("bulkStopSellingProducts failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/**
 * Xóa nhiều hàng hóa theo best-effort. Hàng đã có chứng từ/thẻ kho được giữ lại
 * và trả về trong failedIds để UI báo chính xác cho người dùng.
 */
export async function bulkDeleteProducts(
  ids: string[],
): Promise<
  ActionResult<{ deleted: number; failedIds: string[] }>
> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = bulkProductIdsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  let deleted = 0;
  const failedIds: string[] = [];
  for (const id of parsed.data) {
    try {
      const removed = await db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: products.id, name: products.name, sku: products.sku, isVariantParent: products.isVariantParent })
          .from(products)
          .where(and(eq(products.storeId, gate.storeId), eq(products.id, id)))
          .limit(1).for("update");
        if (!target) return false;
        if (target.isVariantParent) {
          await tx.delete(products).where(and(eq(products.storeId, gate.storeId), eq(products.parentProductId, id)));
        }
        await tx.delete(products).where(and(eq(products.storeId, gate.storeId), eq(products.id, id)));
        await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId, action: "product.deleted", entityType: "product", entityId: id, before: { name: target.name, sku: target.sku }, metadata: { bulk: true, includesVariants: target.isVariantParent } });
        return true;
      });
      if (removed) deleted += 1;
    } catch (e) {
      if (pgErrorCode(e) === "23503") {
        failedIds.push(id);
        continue;
      }
      console.error(`bulkDeleteProducts failed for ${id}:`, e);
      failedIds.push(id);
    }
  }

  revalidatePath(Routes.Products);
  revalidatePath(Routes.Inventory);
  revalidatePath(Routes.POS);
  return { ok: true, data: { deleted, failedIds } };
}

/** Gắn hoặc bỏ sản phẩm khỏi danh sách vật tư dùng trong báo giá camera. */
export async function setCameraMaterial(input: {
  productId: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const gate = await requireFeatureRole("camera_quote_builder", ["owner", "manager", "warehouse"]);
  if (!gate.ok) return gate;
  try {
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ name: products.name, sku: products.sku, specs: products.specs })
        .from(products)
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, input.productId)))
        .limit(1).for("update");
      if (!current) return false;
      const specs = current.specs && typeof current.specs === "object" && !Array.isArray(current.specs)
        ? { ...(current.specs as Record<string, unknown>) }
        : {};
      const wasEnabled = specs.__cameraQuoteMaterial === true;
      if (wasEnabled === input.enabled) return true;
      if (input.enabled) specs.__cameraQuoteMaterial = true;
      else delete specs.__cameraQuoteMaterial;
      await tx.update(products).set({ specs: Object.keys(specs).length > 0 ? specs : null }).where(and(eq(products.storeId, gate.storeId), eq(products.id, input.productId)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "product.camera_material.changed", entityType: "product", entityId: input.productId,
        before: { name: current.name, sku: current.sku, enabled: wasEnabled }, after: { name: current.name, sku: current.sku, enabled: input.enabled },
    });
    return true;
    });
    if (!updated) return { ok: false, error: "errors.invalidData" };
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setCameraMaterial failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

const updateProductStockSchema = z.object({
  id: z.uuid(),
  stockAdjustment: productStockAdjustmentSchema.strict().refine(
    ({ quantity, expectedQuantity }) => quantity !== expectedQuantity,
  ),
}).strict();

/** Stock-only save: keep metadata/media/unit work out of the locked transaction. */
export async function updateProductStock(
  input: z.input<typeof updateProductStockSchema>,
): Promise<ActionResult> {
  // Managers are a subset of stock-access roles; the actor/store stay server-derived.
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = updateProductStockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const { id, stockAdjustment } = parsed.data;

  try {
    const createdBy = await getProfileId(gate.userId);
    await db.transaction((tx) => applyProductStockAdjustment(tx, {
      storeId: gate.storeId,
      productId: id,
      createdBy,
      adjustment: stockAdjustment,
    }), { isolationLevel: "serializable" });
  } catch (e) {
    const known: Record<string, string> = {
      PRODUCT_NOT_FOUND: "errors.invalidData",
      PRODUCT_STOCK_CHANGED: "products.errors.stockChanged",
      PRODUCT_STOCK_REQUIRES_INVENTORY: "products.errors.stockAdjustmentNeedsInventory",
      PRODUCT_STOCK_NOT_MANAGED: "products.errors.stockNotManaged",
      PRODUCT_STOCK_WAREHOUSE_MISSING: "products.errors.stockWarehouseMissing",
    };
    const message = e instanceof Error ? e.message : "";
    if (known[message]) return { ok: false, error: known[message] };
    if (["40001", "40P01"].includes(pgErrorCode(e) ?? "")) {
      return { ok: false, error: "products.errors.stockChanged" };
    }
    console.error("updateProductStock failed:", e);
    return { ok: false, error: "errors.serverError" };
  }

  // One layout invalidation covers detail, list, inventory and POS consumers.
  revalidatePath("/(app)", "layout");
  return { ok: true, data: undefined };
}

/** Cập nhật SP; chỉ điều chỉnh tồn khi gửi kèm số lượng mới và mốc tồn đã đọc. */
export async function updateProduct(
  input: UpdateProductInput,
): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  try {
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const publicMedia = getPublicMediaConfig();

  try {
    if (v.applyToSiblings?.enabled && v.applyToSiblings.fields.some((field) => field === "attributes" || field === "description")) {
      return { ok: false, error: "products.variants.useGroupEditor" };
    }
    if (v.stockAdjustment && v.stockAdjustment.quantity !== v.stockAdjustment.expectedQuantity) {
      const stockGate = await requireManager();
      if (!stockGate.ok) return stockGate;
    }
    const stockActorId = v.stockAdjustment ? await getProfileId(gate.userId) : null;
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          parentProductId: products.parentProductId,
          variantName: products.variantName,
          productKind: products.productKind,
          specs: products.specs,
          relatedProductId: products.relatedProductId,
          isVariantParent: products.isVariantParent,
        })
        .from(products)
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, v.id)))
        .limit(1).for("update");

      if (!current) throw new Error("PRODUCT_NOT_FOUND");
      const hasGroup = current.parentProductId || current.relatedProductId || current.isVariantParent
        || (await tx.execute(sql`select 1 from product_variant_groups where store_id=${gate.storeId}::uuid and id=${v.id}::uuid limit 1`)).rows.length
        || (await tx.execute(sql`select 1 from products where store_id=${gate.storeId}::uuid and related_product_id=${v.id}::uuid limit 1`)).rows.length;
      if (hasGroup) {
        const catalog = await tx.execute<{ name_key: string; attribute_id: string }>(sql`
          select name_key,attribute_id from product_attribute_aliases where store_id=${gate.storeId}::uuid
        `);
        const canonical = (specs: unknown) => Object.entries((specs ?? {}) as Record<string, unknown>)
          .filter(([name]) => !name.startsWith("__"))
          .map(([name, values]) => [catalog.rows.find((a) => a.name_key === variantNameKey(name))?.attribute_id ?? variantNameKey(name), values])
          .sort(([a], [b]) => String(a).localeCompare(String(b)));
        if (JSON.stringify(canonical(current.specs)) !== JSON.stringify(canonical(v.specs))) throw new Error("PRODUCT_VARIANT_IDENTITY");
      }
      const beforeActivity = await readProductActivitySnapshot(tx, gate.storeId, v.id);
      const changedRelatedProducts: { type: string; id: string; name: string; code?: string }[] = [];
      if (
        v.productKind !== undefined &&
        v.productKind !== current.productKind
      ) {
        throw new Error("PRODUCT_KIND_IMMUTABLE");
      }

      await applyProductStockAdjustment(tx, {
        storeId: gate.storeId,
        productId: v.id,
        createdBy: stockActorId,
        adjustment: v.stockAdjustment,
        nextTrackBatches: v.trackBatches,
        nextCategoryId: v.categoryId,
      });

      if (v.imageMediaIds !== undefined || v.imageUrls !== undefined) {
        const imageMediaIds = v.imageMediaIds
          ?? await resolveLegacyProductImageIdsInTransaction(tx, {
            storeId: gate.storeId,
            productId: v.id,
            imageUrls: v.imageUrls ?? [],
            publicMedia,
          });
        await replaceProductMediaInTransaction(tx, {
          storeId: gate.storeId,
          productId: v.id,
          imageMediaIds,
          imageUrls: v.imageUrls ?? [],
          publicMedia,
        });
      }

      await tx
        .update(products)
        .set({
          sku: v.sku,
          barcode: v.barcode || null,
          name: v.name,
          categoryId: v.categoryId || null,
          brandId: v.brandId || null,
          ...(v.supplierIds ? { supplierId: v.supplierIds[0] || null } : {}),
          baseUnit: v.baseUnit,
          costPrice: String(v.costPrice),
          retailPrice: String(v.retailPrice),
          wholesalePrice:
            v.wholesalePrice != null ? String(v.wholesalePrice) : null,
          contractorPrice:
            v.contractorPrice != null ? String(v.contractorPrice) : null,
          agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
          ...(v.vatRate !== undefined
            ? { vatRate: v.vatRate == null ? null : String(v.vatRate) }
            : {}),
          ...(v.priceByWeight != null ? { priceByWeight: v.priceByWeight } : {}),
          ...(v.trackBatches != null ? { trackBatches: v.trackBatches } : {}),
          ...(v.shelfLifeDays !== undefined ? { shelfLifeDays: v.shelfLifeDays } : {}),
          ...(v.lifecycleStatus != null
            ? {
                lifecycleStatus: v.lifecycleStatus,
                isActive: v.lifecycleStatus === "active" && v.isActive,
              }
            : { isActive: v.isActive }),
          location: v.location || null,
          description: v.description || null,
          specs: v.specs && Object.keys(v.specs).length > 0 ? v.specs : null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(products.storeId, gate.storeId), eq(products.id, v.id)));

      await syncProductUnits(tx, {
        storeId: gate.storeId,
        productId: v.id,
        units: v.units,
      });

      if (
        v.comboItems !== undefined
      ) {
        await tx
          .delete(productComboItems)
          .where(and(eq(productComboItems.storeId, gate.storeId), eq(productComboItems.comboProductId, v.id)));
        if (
          current.productKind === "combo" &&
          v.comboItems &&
          v.comboItems.length > 0
        ) {
          await tx.insert(productComboItems).values(
            v.comboItems.map((item, index) => ({
              storeId: gate.storeId,
              comboProductId: v.id,
              componentProductId: item.productId,
              quantity: String(item.quantity),
              sortOrder: index,
            })),
          );
        }
      }

      // NCC do nhập hàng tự gắn — chỉ đồng bộ khi form gửi supplierIds
      if (v.supplierIds) {
        await tx
          .delete(productSuppliers)
          .where(and(eq(productSuppliers.storeId, gate.storeId), eq(productSuppliers.productId, v.id)));
        const sids = [...new Set(v.supplierIds.filter(Boolean))];
        if (sids.length > 0) {
          await tx
            .insert(productSuppliers)
            .values(
              sids.map((sid, i) => ({
                storeId: gate.storeId,
                productId: v.id,
                supplierId: sid,
                isPrimary: i === 0,
              })),
            );
        }
      }

      const apply = v.applyToSiblings;
      if (
        apply?.enabled &&
        apply.fields.length > 0 &&
        current?.parentProductId
      ) {
        const fields = new Set(apply.fields);
        const siblingRows = await tx
          .select({ id: products.id, variantName: products.variantName })
          .from(products)
          .where(
            and(
              eq(products.parentProductId, current.parentProductId),
              eq(products.storeId, gate.storeId),
              ne(products.id, v.id),
            ),
          );

        const patch: Partial<typeof products.$inferInsert> = {
          updatedAt: sql`now()` as unknown as Date,
        };
        if (fields.has("imageUrls") && v.imageUrls) {
          patch.imageUrls = externalProductImageUrls(v.imageUrls, publicMedia);
          patch.imageUpdatedAt = sql`now()` as unknown as Date;
        }
        if (fields.has("category")) patch.categoryId = v.categoryId || null;
        if (fields.has("brand")) patch.brandId = v.brandId || null;
        if (fields.has("directSale")) patch.isActive = v.isActive;
        if (fields.has("pricing")) {
          patch.costPrice = String(v.costPrice);
          patch.retailPrice = String(v.retailPrice);
          patch.wholesalePrice =
            v.wholesalePrice != null ? String(v.wholesalePrice) : null;
          patch.contractorPrice =
            v.contractorPrice != null ? String(v.contractorPrice) : null;
          patch.agentPrice = v.agentPrice != null ? String(v.agentPrice) : null;
        }
        if (fields.has("units")) patch.baseUnit = v.baseUnit;

        const baseName = fields.has("name")
          ? baseNameFromChildName(v.name, current.variantName)
          : null;
        if (baseName) {
          const [parentBefore] = await tx.select({ name: products.name, sku: products.sku }).from(products)
            .where(and(eq(products.storeId, gate.storeId), eq(products.id, current.parentProductId))).limit(1);
          await tx
            .update(products)
            .set({ name: baseName, updatedAt: sql`now()` })
            .where(and(eq(products.storeId, gate.storeId), eq(products.id, current.parentProductId)));
          await tx
            .update(products)
            .set({
              name: current.variantName
                ? childProductName(baseName, current.variantName)
                : baseName,
              updatedAt: sql`now()`,
            })
            .where(and(eq(products.storeId, gate.storeId), eq(products.id, v.id)));
          if (parentBefore && parentBefore.name !== baseName) changedRelatedProducts.push({ type: "product", id: current.parentProductId, code: parentBefore.sku, name: baseName });
        }

        const hasPatch = Object.keys(patch).length > 1;
        for (const sibling of siblingRows) {
          const siblingBefore = await readProductActivitySnapshot(tx, gate.storeId, sibling.id);
          const nextPatch = {
            ...(hasPatch ? patch : {}),
            ...(baseName
              ? {
                  name: sibling.variantName
                    ? childProductName(baseName, sibling.variantName)
                    : baseName,
                }
              : {}),
            updatedAt: sql`now()`,
          };
          await tx
            .update(products)
            .set(nextPatch)
            .where(and(eq(products.storeId, gate.storeId), eq(products.id, sibling.id)));

          if (fields.has("units")) {
            await syncProductUnits(tx, {
              storeId: gate.storeId,
              productId: sibling.id,
              units: v.units.map((unit) => ({
                unitName: unit.unitName,
                multiplier: unit.multiplier,
                barcode: unit.barcode,
                priceOverride: unit.priceOverride,
              })),
            });
          }
          const siblingAfter = await readProductActivitySnapshot(tx, gate.storeId, sibling.id);
          if (siblingBefore && siblingAfter && productActivityChanges(siblingBefore, siblingAfter)) {
            changedRelatedProducts.push({ type: "product", id: sibling.id, code: siblingAfter.sku, name: siblingAfter.name });
          }
        }
      }
      await syncProductPriceBookPrices(gate.storeId, v.id, v.priceBookPrices, tx);
      const afterActivity = await readProductActivitySnapshot(tx, gate.storeId, v.id);
      const changes = beforeActivity && afterActivity ? productActivityChanges(beforeActivity, afterActivity) : null;
      if (afterActivity && (changes || changedRelatedProducts.length)) await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "product.updated", entityType: "product", entityId: v.id,
        before: changes?.before ?? { name: beforeActivity?.name, sku: beforeActivity?.sku },
        after: changes?.after ?? { name: afterActivity.name, sku: afterActivity.sku },
        affectedRecords: changedRelatedProducts,
        metadata: { productName: afterActivity.name, productSku: afterActivity.sku, relatedProductCount: changedRelatedProducts.length },
      });
    }, v.stockAdjustment ? { isolationLevel: "serializable" } : undefined);

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(`/products/${v.id}`);
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    const known: Record<string, string> = {
      PRODUCT_NOT_FOUND: "errors.invalidData",
      PRODUCT_KIND_IMMUTABLE: "products.errors.kindImmutable",
      PRODUCT_VARIANT_IDENTITY: "products.variants.useGroupEditor",
      PRODUCT_UNIT_NOT_FOUND: "errors.invalidData",
      PRODUCT_STOCK_CHANGED: "products.errors.stockChanged",
      PRODUCT_STOCK_REQUIRES_INVENTORY: "products.errors.stockAdjustmentNeedsInventory",
      PRODUCT_STOCK_NOT_MANAGED: "products.errors.stockNotManaged",
      PRODUCT_STOCK_WAREHOUSE_MISSING: "products.errors.stockWarehouseMissing",
    };
    const message = e instanceof Error ? e.message : "";
    if (known[message]) return { ok: false, error: known[message] };
    if (v.stockAdjustment && ["40001", "40P01"].includes(pgErrorCode(e) ?? "")) {
      return { ok: false, error: "products.errors.stockChanged" };
    }
    if (e instanceof ProductMediaValidationError) {
      return { ok: false, error: e.error };
    }
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === "23505")
      return { ok: false, error: "products.errors.skuExists" };
    console.error("updateProduct failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function createProduct(
  input: CreateProductOutput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const userId = gate.userId;
  const storeId = gate.storeId;

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "errors.invalidData" };
  }
  const v = parsed.data;
  if (v.variantGroupId || v.variantChildren.length) {
    if (v.variantContractVersion !== 2 && v.initialStock > 0 && v.variantChildren.length > 1
      && v.variantChildren.every((child) => child.initialStock === v.initialStock)) {
      return { ok: false, error: "products.variants.stockPerSku" };
    }
    return saveProductVariantGroup(v);
  }
  const publicMedia = getPublicMediaConfig();

  const sku = v.sku?.trim() || generateSku();
  const weightKg =
    v.weight != null
      ? v.weightUnit === "g"
        ? v.weight / 1000
        : v.weight
      : null;
  const descriptiveSpecs = specsWithOrderNote(
    specsFromAttributes(v.attributes, { includeVariantAttributes: false }),
    v.invoiceNote,
  );
  const singleProductSpecs = specsWithOrderNote(
    specsFromAttributes(v.attributes, { includeVariantAttributes: true }),
    v.invoiceNote,
  );
  const variantChildren = v.variantChildren.filter((child) =>
    child.variantName.trim(),
  );
  const validUnits = v.units.filter(
    (u) => u.unitName.trim() && u.multiplier > 0,
  );
  const supplierIds = [...new Set(v.supplierIds.filter(Boolean))];

  try {
    const result = await db.transaction(async (tx) => {
      async function insertUnits(productId: string) {
        if (validUnits.length === 0) return;
        await tx.insert(productUnits).values(
          validUnits.map((u, i) => ({
            storeId,
            productId,
            unitName: u.unitName.trim(),
            multiplier: String(u.multiplier),
            barcode: u.barcode?.trim() || null,
            priceOverride:
              u.priceOverride != null ? String(u.priceOverride) : null,
            sortOrder: i,
          })),
        );
      }

      async function insertSuppliers(productId: string) {
        if (supplierIds.length === 0) return;
        await tx
          .insert(productSuppliers)
          .values(
            supplierIds.map((sid, i) => ({
              storeId,
              productId,
              supplierId: sid,
              isPrimary: i === 0,
            })),
          );
      }

      async function associateImages(productId: string) {
        const imageMediaIds = v.imageMediaIds.length > 0
          ? v.imageMediaIds
          : await resolveLegacyProductImageIdsInTransaction(tx, {
            storeId,
            productId,
            imageUrls: v.imageUrls,
            publicMedia,
          });
        return replaceProductMediaInTransaction(tx, {
          storeId,
          productId,
          imageMediaIds,
          imageUrls: v.imageUrls,
          publicMedia,
        });
      }

      const [defaultWh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.storeId, storeId), eq(warehouses.isDefault, true)))
        .limit(1);
      const [profile] = defaultWh
        ? await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(and(eq(profiles.storeId, storeId), eq(profiles.id, userId)))
            .limit(1)
        : [null];

      async function insertInitialStock(
        productId: string,
        quantity: number,
        minLevel: number,
        unitCost: number,
      ) {
        if (!defaultWh) return;
        await tx.insert(stockLevels).values({
          storeId,
          productId,
          warehouseId: defaultWh.id,
          quantity: String(quantity),
          minLevel: String(minLevel),
        });

        if (quantity > 0) {
          await tx.insert(stockMovements).values({
            storeId,
            productId,
            warehouseId: defaultWh.id,
            type: "init",
            quantity: String(quantity),
            unitCost: String(unitCost),
            refType: "product_init",
            refId: productId,
            note: "Tồn đầu khi tạo sản phẩm",
            createdBy: profile?.id ?? null,
          });
        }
      }

      if (variantChildren.length === 0) {
        const [product] = await tx
          .insert(products)
          .values({
            storeId,
            sku,
            productKind: v.productKind,
            barcode: v.barcode?.trim() || null,
            name: v.name.trim(),
            description: v.description || null,
            categoryId: v.categoryId || null,
            brandId: v.brandId || null,
            supplierId: v.supplierIds[0] || null, // NCC chính = phần tử đầu
            baseUnit: v.baseUnit || "cái",
            costPrice: String(v.costPrice),
            retailPrice: String(v.retailPrice),
            wholesalePrice:
              v.wholesalePrice != null ? String(v.wholesalePrice) : null,
            contractorPrice:
              v.contractorPrice != null ? String(v.contractorPrice) : null,
            agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
            vatRate: v.vatRate == null ? null : String(v.vatRate),
            priceByWeight: v.priceByWeight,
            trackBatches: v.trackBatches,
            shelfLifeDays: v.shelfLifeDays ?? null,
            lifecycleStatus: v.lifecycleStatus,
            m2PerUnit: computeM2PerUnit(v),
            location: v.location?.trim() || null,
            weight: weightKg != null ? String(weightKg) : null,
            dimensions: buildDimensions(v),
            specs: singleProductSpecs,
            imageUrls: v.imageUrls,
            isActive: v.lifecycleStatus === "active" && v.directSale,
          })
          .returning({ id: products.id });

        await associateImages(product.id);
        await insertUnits(product.id);
        await insertSuppliers(product.id);
        if (v.productKind === "product") {
          await insertInitialStock(
            product.id,
            v.initialStock,
            v.minLevel,
            v.costPrice,
          );
        }
        if (v.productKind === "combo") {
          await tx.insert(productComboItems).values(
            v.comboItems.map((item, index) => ({
              storeId,
              comboProductId: product.id,
              componentProductId: item.productId,
              quantity: String(item.quantity),
              sortOrder: index,
            })),
          );
        }
        await syncProductPriceBookPrices(storeId, product.id, v.priceBookPrices, tx);
        await recordActivity(tx, {
          storeId, actorId: userId, action: "product.created", entityType: "product", entityId: product.id,
          after: { name: v.name.trim(), sku, productKind: v.productKind, costPrice: v.costPrice, retailPrice: v.retailPrice, quantity: v.productKind === "product" && defaultWh ? v.initialStock : undefined, status: v.lifecycleStatus, isActive: v.lifecycleStatus === "active" && v.directSale },
          metadata: { productName: v.name.trim(), productSku: sku },
        });
        return product;
      }

      const [parent] = await tx
        .insert(products)
        .values({
          storeId,
          sku,
          productKind: "product",
          barcode: v.barcode?.trim() || null,
          name: v.name.trim(),
          description: v.description || null,
          categoryId: v.categoryId || null,
          brandId: v.brandId || null,
          supplierId: v.supplierIds[0] || null,
          baseUnit: v.baseUnit || "cái",
          costPrice: String(v.costPrice),
          retailPrice: String(v.retailPrice),
          wholesalePrice:
            v.wholesalePrice != null ? String(v.wholesalePrice) : null,
          contractorPrice:
            v.contractorPrice != null ? String(v.contractorPrice) : null,
          agentPrice: v.agentPrice != null ? String(v.agentPrice) : null,
          vatRate: v.vatRate == null ? null : String(v.vatRate),
          priceByWeight: v.priceByWeight,
          trackBatches: v.trackBatches,
          shelfLifeDays: v.shelfLifeDays ?? null,
          lifecycleStatus: v.lifecycleStatus,
          m2PerUnit: computeM2PerUnit(v),
          location: v.location?.trim() || null,
          weight: weightKg != null ? String(weightKg) : null,
          dimensions: buildDimensions(v),
          specs: descriptiveSpecs,
          imageUrls: v.imageUrls,
          isVariantParent: true,
          isActive: false,
        })
        .returning({ id: products.id });

      const parentImages = await associateImages(parent.id);
      await insertUnits(parent.id);
      await insertSuppliers(parent.id);

      const createdVariants: { type: string; id: string; name: string; code: string; quantity: number }[] = [];
      for (const [index, child] of variantChildren.entries()) {
        const childWholesale =
          child.wholesalePrice != null
            ? child.wholesalePrice
            : v.wholesalePrice;
        const childContractor =
          child.contractorPrice != null
            ? child.contractorPrice
            : v.contractorPrice;
        const childAgent =
          child.agentPrice != null ? child.agentPrice : v.agentPrice;
        const [childProduct] = await tx
          .insert(products)
          .values({
            storeId,
            sku: child.sku?.trim() || generateVariantSku(sku, index),
            productKind: "product",
            barcode: child.barcode?.trim() || null,
            name: childProductName(v.name, child.variantName),
            parentProductId: parent.id,
            variantName: child.variantName.trim(),
            description: v.description || null,
            categoryId: v.categoryId || null,
            brandId: v.brandId || null,
            supplierId: v.supplierIds[0] || null,
            baseUnit: child.baseUnit || v.baseUnit || "cái",
            costPrice: String(child.costPrice),
            retailPrice: String(child.retailPrice),
            wholesalePrice:
              childWholesale != null ? String(childWholesale) : null,
            contractorPrice:
              childContractor != null ? String(childContractor) : null,
            agentPrice: childAgent != null ? String(childAgent) : null,
            vatRate: v.vatRate == null ? null : String(v.vatRate),
            priceByWeight: v.priceByWeight,
            trackBatches: v.trackBatches,
            shelfLifeDays: v.shelfLifeDays ?? null,
            lifecycleStatus: v.lifecycleStatus,
            m2PerUnit: computeM2PerUnit(v),
            location: v.location?.trim() || null,
            weight: weightKg != null ? String(weightKg) : null,
            dimensions: buildDimensions(v),
            specs: mergeSpecs(descriptiveSpecs, child.specs),
            imageUrls:
              child.imageUrls.length > 0
                ? externalProductImageUrls(child.imageUrls, publicMedia)
                : parentImages.externalImageUrls,
            isActive: v.lifecycleStatus === "active" && child.directSale,
          })
          .returning({ id: products.id });

        await insertUnits(childProduct.id);
        await insertSuppliers(childProduct.id);
        await insertInitialStock(
          childProduct.id,
          child.initialStock,
          child.minLevel,
          child.costPrice,
        );
        createdVariants.push({ type: "product", id: childProduct.id, name: childProductName(v.name, child.variantName), code: child.sku?.trim() || generateVariantSku(sku, index), quantity: defaultWh ? child.initialStock : 0 });
      }

      await syncProductPriceBookPrices(storeId, parent.id, v.priceBookPrices, tx);
      await recordActivity(tx, {
        storeId, actorId: userId, action: "product.created", entityType: "product", entityId: parent.id,
        after: { name: v.name.trim(), sku, productKind: "product", costPrice: v.costPrice, retailPrice: v.retailPrice, variantCount: createdVariants.length, status: v.lifecycleStatus },
        affectedRecords: createdVariants,
        metadata: { productName: v.name.trim(), productSku: sku },
      });
      return parent;
    });

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: { id: result.id } };
  } catch (e) {
    // Drizzle bọc lỗi PG vào DrizzleQueryError — lỗi gốc nằm ở e.cause
    const cause = (e as { cause?: { code?: string; constraint_name?: string } })
      .cause;
    const msg = e instanceof Error ? e.message : "";
    if (
      cause?.code === "23505" || // unique_violation
      cause?.constraint_name?.includes("sku") ||
      msg.includes("duplicate key")
    ) {
      return { ok: false, error: "products.errors.skuExists" };
    }
    if (e instanceof ProductMediaValidationError) {
      return { ok: false, error: e.error };
    }
    console.error("createProduct failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  products,
  productUnits,
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
  siblingApplySchema,
  type CreateProductOutput,
} from "@/app/(app)/products/new/schema";
import { Routes } from "@/lib/routes";
import {
  pgErrorCode,
  requireStockAccess,
  requireManager,
  toMoney,
} from "./common";

/** Tạo nhóm hàng mới từ form (combobox "+ thêm"). Trả id. */
export async function createCategory(
  name: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [row] = await db
      .insert(categories)
      .values({ name: n })
      .returning({ id: categories.id, name: categories.name });
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
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  const n = input.name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [row] = await db
      .insert(categories)
      .values({ name: n, parentId: input.parentId || null })
      .returning({ id: categories.id });
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
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  const patch: { name?: string; parentId?: string | null } = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "errors.invalidData" };
    patch.name = n;
  }
  if (input.parentId !== undefined)
    patch.parentId = input.parentId === id ? null : input.parentId || null;
  try {
    await db.update(categories).set(patch).where(eq(categories.id, id));
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
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  try {
    await db
      .update(products)
      .set({ categoryId: null })
      .where(eq(products.categoryId, id));
    await db
      .update(categories)
      .set({ parentId: null })
      .where(eq(categories.parentId, id));
    await db.delete(categories).where(eq(categories.id, id));
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
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  const n = name.trim();
  if (!n) return { ok: false, error: "errors.invalidData" };
  try {
    const [existing] = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.name, n))
      .limit(1);
    if (existing) return { ok: true, data: existing };
    const [row] = await db
      .insert(brands)
      .values({ name: n })
      .returning({ id: brands.id, name: brands.name });
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
  productId: string,
  input: Record<string, number | null | undefined> | undefined,
) {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return;

  const bookIds = [...new Set(entries.map(([id]) => id).filter(Boolean))];
  if (bookIds.length === 0) return;

  const validBooks = await db
    .select({ id: priceBooks.id, isDefault: priceBooks.isDefault })
    .from(priceBooks)
    .where(inArray(priceBooks.id, bookIds));
  const nonDefaultIds = new Set(
    validBooks.filter((book) => !book.isDefault).map((book) => book.id),
  );

  const toDelete = entries
    .filter(([bookId, price]) => nonDefaultIds.has(bookId) && price == null)
    .map(([bookId]) => bookId);
  if (toDelete.length > 0) {
    await db
      .delete(productPrices)
      .where(
        and(
          eq(productPrices.productId, productId),
          inArray(productPrices.priceBookId, toDelete),
        ),
      );
  }

  const toUpsert = entries
    .filter(([bookId, price]) => nonDefaultIds.has(bookId) && price != null)
    .map(([bookId, price]) => ({
      priceBookId: bookId,
      productId,
      price: toMoney(Math.max(0, Number(price))),
    }));
  if (toUpsert.length > 0) {
    await db
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
  {
    const gate = await requireManager();
    if (!gate.ok) return gate;
  }
  try {
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = updatePricesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    await db
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
      .where(eq(products.id, v.productId));

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
  isActive: z.boolean(),
  specs: z.record(z.string(), z.array(z.string())).nullable(),
  applyToSiblings: siblingApplySchema.optional(),
  units: z.array(
    z.object({
      unitName: z.string().trim().min(1),
      multiplier: z.number().positive(),
      barcode: z.string().trim().optional(),
      priceOverride: z.number().min(0).nullable(),
    }),
  ),
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

const productIdSchema = z.uuid();

/** Xóa hàng hóa nếu chưa phát sinh chứng từ/thẻ kho liên quan. */
export async function deleteProduct(id: string): Promise<ActionResult> {
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  const parsed = productIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: products.id, isVariantParent: products.isVariantParent })
        .from(products)
        .where(eq(products.id, parsed.data))
        .limit(1);
      if (!target) return;

      if (target.isVariantParent) {
        await tx
          .delete(products)
          .where(eq(products.parentProductId, target.id));
      }
      await tx.delete(products).where(eq(products.id, target.id));
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

/** Bật/tắt kinh doanh. Với nhóm biến thể, áp dụng cho cả nhóm con. */
export async function setProductActive(
  input: z.input<typeof setProductActiveSchema>,
): Promise<ActionResult> {
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  const parsed = setProductActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const [target] = await db
      .select({ id: products.id, isVariantParent: products.isVariantParent })
      .from(products)
      .where(eq(products.id, v.productId))
      .limit(1);
    if (!target) return { ok: false, error: "errors.invalidData" };

    await db
      .update(products)
      .set({
        isActive: v.isActive,
        lifecycleStatus: v.isActive ? "active" : "archived",
        updatedAt: sql`now()`,
      })
      .where(
        target.isVariantParent
          ? or(
              eq(products.id, target.id),
              eq(products.parentProductId, target.id),
            )
          : eq(products.id, target.id),
      );

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.POS);
    revalidatePath(`/products/${target.id}`);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setProductActive failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Gắn hoặc bỏ sản phẩm khỏi danh sách vật tư dùng trong báo giá camera. */
export async function setCameraMaterial(input: {
  productId: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  try {
    const [current] = await db
      .select({ specs: products.specs })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!current) return { ok: false, error: "errors.invalidData" };
    const specs = current.specs && typeof current.specs === "object" && !Array.isArray(current.specs)
      ? { ...(current.specs as Record<string, unknown>) }
      : {};
    if (input.enabled) specs.__cameraQuoteMaterial = true;
    else delete specs.__cameraQuoteMaterial;
    await db.update(products).set({ specs: Object.keys(specs).length > 0 ? specs : null }).where(eq(products.id, input.productId));
    revalidatePath(Routes.Inventory);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setCameraMaterial failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Cập nhật thông tin SP (không đụng tồn kho — tồn quản lý ở Kho/Kiểm kho). */
export async function updateProduct(
  input: UpdateProductInput,
): Promise<ActionResult> {
  {
    const gate = await requireStockAccess();
    if (!gate.ok) return gate;
  }
  try {
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          parentProductId: products.parentProductId,
          variantName: products.variantName,
        })
        .from(products)
        .where(eq(products.id, v.id))
        .limit(1);

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
          ...(v.imageUrls ? { imageUrls: v.imageUrls } : {}),
          specs: v.specs && Object.keys(v.specs).length > 0 ? v.specs : null,
          updatedAt: sql`now()`,
        })
        .where(eq(products.id, v.id));

      // thay toàn bộ đơn vị quy đổi
      await tx.delete(productUnits).where(eq(productUnits.productId, v.id));
      const valid = v.units.filter((u) => u.unitName && u.multiplier > 0);
      if (valid.length > 0) {
        await tx.insert(productUnits).values(
          valid.map((u, i) => ({
            productId: v.id,
            unitName: u.unitName,
            multiplier: String(u.multiplier),
            barcode: u.barcode || null,
            priceOverride:
              u.priceOverride != null ? String(u.priceOverride) : null,
            sortOrder: i,
          })),
        );
      }

      // NCC do nhập hàng tự gắn — chỉ đồng bộ khi form gửi supplierIds
      if (v.supplierIds) {
        await tx
          .delete(productSuppliers)
          .where(eq(productSuppliers.productId, v.id));
        const sids = [...new Set(v.supplierIds.filter(Boolean))];
        if (sids.length > 0) {
          await tx
            .insert(productSuppliers)
            .values(
              sids.map((sid, i) => ({
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
              ne(products.id, v.id),
            ),
          );

        const patch: Partial<typeof products.$inferInsert> = {
          updatedAt: sql`now()` as unknown as Date,
        };
        if (fields.has("description"))
          patch.description = v.description || null;
        if (fields.has("imageUrls") && v.imageUrls)
          patch.imageUrls = v.imageUrls;
        if (fields.has("category")) patch.categoryId = v.categoryId || null;
        if (fields.has("brand")) patch.brandId = v.brandId || null;
        if (fields.has("directSale")) patch.isActive = v.isActive;
        if (fields.has("attributes"))
          patch.specs =
            v.specs && Object.keys(v.specs).length > 0 ? v.specs : null;
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
          await tx
            .update(products)
            .set({ name: baseName, updatedAt: sql`now()` })
            .where(eq(products.id, current.parentProductId));
          await tx
            .update(products)
            .set({
              name: current.variantName
                ? childProductName(baseName, current.variantName)
                : baseName,
              updatedAt: sql`now()`,
            })
            .where(eq(products.id, v.id));
        }

        const hasPatch = Object.keys(patch).length > 1;
        for (const sibling of siblingRows) {
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
            .where(eq(products.id, sibling.id));

          if (fields.has("units")) {
            await tx
              .delete(productUnits)
              .where(eq(productUnits.productId, sibling.id));
            if (valid.length > 0) {
              await tx.insert(productUnits).values(
                valid.map((u, i) => ({
                  productId: sibling.id,
                  unitName: u.unitName,
                  multiplier: String(u.multiplier),
                  barcode: u.barcode || null,
                  priceOverride:
                    u.priceOverride != null ? String(u.priceOverride) : null,
                  sortOrder: i,
                })),
              );
            }
          }
        }
      }
    });
    await syncProductPriceBookPrices(v.id, v.priceBookPrices);

    revalidatePath(Routes.Products);
    revalidatePath(Routes.Inventory);
    revalidatePath(`/products/${v.id}`);
    revalidatePath(Routes.Pricing);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
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

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "errors.invalidData" };
  }
  const v = parsed.data;

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
              productId,
              supplierId: sid,
              isPrimary: i === 0,
            })),
          );
      }

      const [defaultWh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.isDefault, true))
        .limit(1);
      const [profile] = defaultWh
        ? await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, userId))
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
          productId,
          warehouseId: defaultWh.id,
          quantity: String(quantity),
          minLevel: String(minLevel),
        });

        if (quantity > 0) {
          await tx.insert(stockMovements).values({
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

        await insertUnits(product.id);
        await insertSuppliers(product.id);
        await insertInitialStock(
          product.id,
          v.initialStock,
          v.minLevel,
          v.costPrice,
        );
        return product;
      }

      const [parent] = await tx
        .insert(products)
        .values({
          sku,
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

      await insertUnits(parent.id);
      await insertSuppliers(parent.id);

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
            sku: child.sku?.trim() || generateVariantSku(sku, index),
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
              child.imageUrls.length > 0 ? child.imageUrls : v.imageUrls,
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
      }

      return parent;
    });

    await syncProductPriceBookPrices(result.id, v.priceBookPrices);

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
    console.error("createProduct failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

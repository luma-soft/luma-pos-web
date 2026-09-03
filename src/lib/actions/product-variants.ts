"use server";

import { db } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { products } from "@/db/schema";
import { createProductSchema, type CreateProductInput } from "@/app/(app)/products/new/schema";
import { requireStockAccess, pgErrorCode, type ActionResult } from "./common";
import { saveVariantGroupInTransaction } from "@/lib/products/variant-write";
import { VariantValidationError } from "@/lib/products/variant-model";
import { revalidateAppData } from "@/lib/sync/revalidate-app-data";
import { recordActivity } from "@/lib/audit/activity-log";
import { getPublicMediaConfig } from "@/lib/media/config";
import { replaceProductMediaInTransaction, resolveLegacyProductImageIdsInTransaction, ProductMediaValidationError } from "@/lib/products/product-media";

export async function saveProductVariantGroup(input: CreateProductInput): Promise<ActionResult<{ id: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "errors.invalidData" };
  const v = parsed.data;
  if (v.productKind !== "product") return { ok: false, error: "products.errors.kindCannotHaveVariants" };
  try {
    const result = await db.transaction(async (tx) => {
      const saved = await saveVariantGroupInTransaction(tx, gate.storeId, gate.userId, v);
      if (!saved.replayed) {
        if (v.imageUrls.length || v.imageMediaIds.length || (v.variantGroupId && v.variantOperation === "edit")) {
          const publicMedia = getPublicMediaConfig();
          const mediaIds = [...new Set([...saved.createdIds, ...(v.variantGroupId && v.variantOperation === "edit" ? [saved.id] : [])])];
          const records = mediaIds.length ? await tx.select({ id: products.id, imageUrls: products.imageUrls }).from(products)
            .where(and(eq(products.storeId, gate.storeId), inArray(products.id, mediaIds))) : [];
          for (const record of records) {
            const imageUrls = record.imageUrls ?? [];
            const imageMediaIds = JSON.stringify(imageUrls) === JSON.stringify(v.imageUrls) && v.imageMediaIds.length
              ? v.imageMediaIds : await resolveLegacyProductImageIdsInTransaction(tx, { storeId: gate.storeId, productId: record.id, imageUrls, publicMedia });
            await replaceProductMediaInTransaction(tx, { storeId: gate.storeId, productId: record.id, imageMediaIds, imageUrls, publicMedia });
          }
        }
        await recordActivity(tx, { storeId: gate.storeId, actorId: gate.userId,
          action: v.variantGroupId ? "product.updated" : "product.created", entityType: "product", entityId: saved.id,
          after: { name: v.name, variantCount: saved.memberIds.length, revision: saved.revision },
          affectedRecords: saved.memberIds.map((id) => ({ type: "product", id })), metadata: { operation: v.variantOperation, requestId: v.requestId } });
      }
      return saved;
    });
    revalidateAppData("/(app)", "layout");
    return { ok: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof VariantValidationError) return { ok: false, error: error.code };
    if (error instanceof ProductMediaValidationError) return { ok: false, error: error.error };
    if (pgErrorCode(error) === "23505") return { ok: false, error: "products.errors.skuExists" };
    if (["40001", "40P01"].includes(pgErrorCode(error) ?? "")) return { ok: false, error: "products.variants.groupChanged" };
    console.error("saveProductVariantGroup failed", error);
    return { ok: false, error: "errors.serverError" };
  }
}

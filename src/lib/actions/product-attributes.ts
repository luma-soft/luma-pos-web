"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { productAttributes } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { revalidateAppData } from "@/lib/sync/revalidate-app-data";
import { attributeNameSchema, type ProductAttribute } from "@/lib/products/attribute-catalog";
import { pgErrorCode, requireStockAccess, type ActionResult } from "./common";

function mutationError(error: unknown): ActionResult<never> {
  const code = pgErrorCode(error);
  if (code === "23505") return { ok: false, error: "products.attributes.duplicate" };
  if (code === "23503") return { ok: false, error: "products.attributes.inUse" };
  if (code === "55P03" || code === "40P01" || code === "57014") {
    return { ok: false, error: "products.attributes.busy" };
  }
  console.error("Product attribute operation failed", { code });
  return { ok: false, error: "products.attributes.failed" };
}

export async function getProductAttributes(): Promise<ActionResult<ProductAttribute[]>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  try {
    const rows = await db.execute<ProductAttribute>(sql`
      select a.id, a.name,
        coalesce((select jsonb_agg(n.name_key) from product_attribute_aliases n
          where n.store_id = a.store_id and n.attribute_id = a.id), '[]'::jsonb) as aliases,
        (select count(*)::int from product_attribute_products u
          where u.store_id = a.store_id and u.attribute_id = a.id) as "productCount"
      from product_attributes a where a.store_id = ${gate.storeId}
      order by a.name
    `);
    return { ok: true, data: rows.rows };
  } catch (error) { return mutationError(error); }
}

export async function createProductAttribute(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = attributeNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: "products.attributes.invalidName" };
  try {
    const [created] = await db.insert(productAttributes).values({ storeId: gate.storeId, name: parsed.data })
      .returning({ id: productAttributes.id, name: productAttributes.name });
    await writeAuditLog({ storeId: gate.storeId, actorUserId: gate.userId, source: "manual", action: "attribute.created", entityType: "product_attribute", entityId: created.id, after: { name: created.name } });
    revalidateAppData("/inventory");
    return { ok: true, data: created };
  } catch (error) { return mutationError(error); }
}

export async function renameProductAttribute(id: string, name: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = attributeNameSchema.safeParse(name);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { ok: false, error: "products.attributes.invalidName" };
  try {
    const renamed = await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const result = await tx.execute<{ renamed: boolean }>(sql`select public.rename_product_attribute(${gate.storeId}::uuid, ${id}::uuid, ${parsed.data}) as renamed`);
      return result.rows[0].renamed;
    });
    if (!renamed) return { ok: false, error: "products.attributes.notFound" };
    await writeAuditLog({ storeId: gate.storeId, actorUserId: gate.userId, source: "manual", action: "attribute.renamed", entityType: "product_attribute", entityId: id, after: { name: parsed.data } });
    revalidateAppData("/(app)", "layout");
    return { ok: true, data: undefined };
  } catch (error) { return mutationError(error); }
}

export async function deleteProductAttribute(id: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "products.attributes.notFound" };
  try {
    // The usage FK rejects deletion even if a product was added after the UI loaded.
    const [deleted] = await db.delete(productAttributes)
      .where(and(eq(productAttributes.storeId, gate.storeId), eq(productAttributes.id, id)))
      .returning({ name: productAttributes.name });
    if (!deleted) return { ok: false, error: "products.attributes.notFound" };
    await writeAuditLog({ storeId: gate.storeId, actorUserId: gate.userId, source: "manual", action: "attribute.deleted", entityType: "product_attribute", entityId: id, before: { name: deleted.name } });
    revalidateAppData("/inventory");
    return { ok: true, data: undefined };
  } catch (error) { return mutationError(error); }
}

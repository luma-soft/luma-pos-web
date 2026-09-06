import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { productSuppliers, suppliers, warehouses } from "@/db/schema";
import { createPurchase, savePurchaseDraft } from "@/lib/actions/purchases";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, readJson } from "@/lib/mobile/response";

async function defaultWarehouseId() {
  const [warehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .orderBy(desc(warehouses.isDefault))
    .limit(1);
  return warehouse?.id ?? null;
}

async function defaultSupplierId(productId?: string) {
  if (productId) {
    const [primary] = await db
      .select({ id: productSuppliers.supplierId })
      .from(productSuppliers)
      .where(eq(productSuppliers.productId, productId))
      .orderBy(desc(productSuppliers.isPrimary))
      .limit(1);
    if (primary?.id) return primary.id;
  }
  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .limit(1);
  return supplier?.id ?? null;
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return mobileAction({ ok: false, error: "errors.invalidData" });
  const payload = body as Record<string, unknown>;
  if (payload.intent === "draft") {
    // Drafts require an explicit supplier and warehouse and never receive stock.
    return mobileAction(await savePurchaseDraft({ ...payload, id: undefined } as Parameters<typeof savePurchaseDraft>[0]));
  }
  if (payload.intent != null && payload.intent !== "receive") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  const firstProductId =
    typeof (items[0] as { productId?: unknown } | undefined)?.productId === "string"
      ? ((items[0] as { productId: string }).productId)
      : undefined;
  const warehouseId =
    typeof payload.warehouseId === "string"
      ? payload.warehouseId
      : await defaultWarehouseId();
  const supplierId =
    typeof payload.supplierId === "string"
      ? payload.supplierId
      : await defaultSupplierId(firstProductId);
  if (!warehouseId || !supplierId) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  return mobileAction(
    await createPurchase({
      ...payload,
      warehouseId,
      supplierId,
      items,
    } as Parameters<typeof createPurchase>[0])
  );
}

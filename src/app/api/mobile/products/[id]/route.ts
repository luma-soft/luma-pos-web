import {
  deleteProduct,
  setCameraMaterial,
  setProductActive,
  updateProduct,
  updateProductStock,
} from "@/lib/actions/products";
import { getProduct } from "@/lib/data/products";
import { saveProductVariantGroup } from "@/lib/actions/product-variants";
import type { CreateProductInput } from "@/app/(app)/products/new/schema";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const product = await getProduct(gate.storeId, id);
  if (!product) return mobileError("errors.notFound", 404);
  return mobileOk(product);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const action = (body as Record<string, unknown>).action;
  if (action === "save-variants") {
    return mobileAction(await saveProductVariantGroup({ ...(body as CreateProductInput), variantGroupId: id }));
  }
  if (action === "set-active") {
    const isActive = (body as Record<string, unknown>).isActive;
    if (typeof isActive !== "boolean") {
      return mobileAction({ ok: false, error: "errors.invalidData" });
    }
    return mobileAction(
      await setProductActive({
        productId: id,
        isActive,
      }),
    );
  }
  if (action === "set-camera-material") {
    const enabled = (body as Record<string, unknown>).enabled;
    if (typeof enabled !== "boolean") {
      return mobileAction({ ok: false, error: "errors.invalidData" });
    }
    return mobileAction(
      await setCameraMaterial({
        productId: id,
        enabled,
      }),
    );
  }

  if (action === "set-stock" && Object.keys(body).some(
    (key) => key !== "action" && key !== "stockAdjustment",
  )) {
    return mobileError("errors.invalidData");
  }
  const result = action === "set-stock"
    ? await updateProductStock({
      id,
      stockAdjustment: (body as Parameters<typeof updateProductStock>[0]).stockAdjustment,
    })
    : await updateProduct({
      ...(body as Record<string, unknown>),
      id,
    } as Parameters<typeof updateProduct>[0]);
  if (!result.ok) return mobileAction(result);

  // Return the committed projection in this round-trip. A failed read must not
  // turn an already-committed mutation into an error the client might retry.
  try {
    const product = await getProduct(gate.storeId, id);
    return mobileOk({ product, ...(!product ? { refreshRequired: true } : {}) });
  } catch (error) {
    console.error("Product saved, but detail refresh failed:", error);
    return mobileOk({ product: null, refreshRequired: true });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  return mobileAction(await deleteProduct(id));
}

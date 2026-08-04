import {
  deleteProduct,
  setCameraMaterial,
  setProductActive,
  updateProduct,
} from "@/lib/actions/products";
import { getProduct } from "@/lib/data/products";
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
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return mobileError("errors.notFound", 404);
  return mobileOk(product);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }

  const action = (body as Record<string, unknown>).action;
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

  return mobileAction(
    await updateProduct({
      ...(body as Record<string, unknown>),
      id,
    } as Parameters<typeof updateProduct>[0])
  );
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

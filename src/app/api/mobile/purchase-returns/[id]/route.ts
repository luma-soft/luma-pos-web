import { inventoryDocumentCapabilities } from "@/lib/inventory/document-capabilities";
import { updatePurchaseReturn, deletePurchaseReturn } from "@/lib/actions/purchase-returns";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { getPurchaseReturn } from "@/lib/data/purchase-returns";
import { requireMobileStockReadAccess, requireMobileManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, mobileAction, readJson } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const purchaseReturn = await getPurchaseReturn(gate.storeId, id);
  return purchaseReturn
    ? mobileOk({ ...purchaseReturn, ...inventoryDocumentCapabilities("purchase-returns", gate.role) })
    : mobileError("errors.notFound", 404);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return mobileError("errors.invalidData");
  return mobileAction(await updatePurchaseReturn(id, body));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;
  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);
  return mobileAction(await deletePurchaseReturn(id));
}

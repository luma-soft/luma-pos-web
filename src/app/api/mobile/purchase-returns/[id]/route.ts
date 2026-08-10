import { getPurchaseReturn } from "@/lib/data/purchase-returns";
import { requireMobileStockReadAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  const purchaseReturn = await getPurchaseReturn(gate.storeId, id);
  return purchaseReturn
    ? mobileOk(purchaseReturn)
    : mobileError("errors.notFound", 404);
}

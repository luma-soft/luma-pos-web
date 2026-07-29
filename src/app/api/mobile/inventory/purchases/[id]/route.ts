import { getPurchase } from "@/lib/data/inventory";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileError, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileStockAccess();
  const { id } = await params;
  if (!gate.ok || !isMobileEntityId(id)) {
    return mobileError("errors.notFound", 404);
  }

  const purchase = await getPurchase(id);
  if (!purchase) return mobileError("errors.notFound", 404);
  return mobileOk({
    id: purchase.id,
    code: purchase.code,
    createdAt: purchase.createdAt,
    supplierName: purchase.supplierName,
    itemCount: purchase.items.length,
    total: Number(purchase.total),
  });
}

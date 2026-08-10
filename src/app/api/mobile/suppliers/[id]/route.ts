import { getSupplier } from "@/lib/data/partners";
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

  const supplier = await getSupplier(gate.storeId, id);
  if (!supplier) return mobileError("errors.notFound", 404);
  return mobileOk({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    phone: supplier.phone,
    taxCode: supplier.taxCode,
    currentDebt: Number(supplier.currentDebt),
  });
}

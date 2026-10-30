import { getSupplier } from "@/lib/data/partners";
import { Routes } from "@/lib/routes";
import { revalidateAppData } from "@/lib/sync/revalidate-app-data";
import { deleteSupplierCore } from "@/lib/suppliers/write";
import { requireMobileManager, requireMobileStockAccess } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileAction, mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileManager();
  if (!gate.ok) return mobileGate(gate)!;

  const { id } = await params;
  if (!isMobileEntityId(id)) return mobileError("errors.notFound", 404);

  const result = await deleteSupplierCore(gate.storeId, gate.userId, id);
  if (result.ok) {
    revalidateAppData(Routes.Suppliers);
    revalidateAppData(Routes.Partners);
    revalidateAppData(Routes.Products);
    revalidateAppData(Routes.Inventory);
  }
  return mobileAction(result);
}

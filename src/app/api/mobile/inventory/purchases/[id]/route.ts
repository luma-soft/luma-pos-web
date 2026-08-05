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
    status: purchase.status,
    createdAt: purchase.createdAt,
    supplierId: purchase.supplierId,
    supplierName: purchase.supplierName,
    supplierPhone: purchase.supplierPhone,
    warehouseId: purchase.warehouseId,
    warehouseName: purchase.warehouseName,
    invoiceNumber: purchase.invoiceNumber,
    createdByName: purchase.createdByName,
    itemCount: purchase.items.length,
    subtotal: Number(purchase.subtotal),
    discount: Number(purchase.discount),
    vatRate: Number(purchase.vatRate),
    tax: Number(purchase.tax),
    total: Number(purchase.total),
    amountPaid: Number(purchase.amountPaid),
    note: purchase.note,
    items: purchase.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      baseUnit: item.baseUnit,
      quantity: Number(item.quantity),
      unitCost: Number(item.unitCost),
      discount: Number(item.discount),
      total: Number(item.total),
      imageUrl: item.imageUrls?.[0] ?? null,
      imageUpdatedAt: item.imageUpdatedAt,
      batchNumber: item.batchNumber,
      expiryDate: item.expiryDate,
    })),
  });
}

import { notFound } from "next/navigation";
import { getPurchase, getPurchaseFormOptions, getPurchaseProductRowsByIds } from "@/lib/data/inventory";
import { PurchaseForm } from "../../new/purchase-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireStoreContext();
  const purchase = await getPurchase(context.storeId, id).catch(() => null);
  if (!purchase || (purchase.status !== "received" && purchase.status !== "draft")) notFound();

  const [options, initialProducts] = await Promise.all([
    getPurchaseFormOptions(context.storeId),
    getPurchaseProductRowsByIds(
      context.storeId,
      purchase.items.map((i) => i.productId),
      { includeInactive: true },
    ),
  ]);

  return (
    <PurchaseForm
      options={options}
      initialProducts={initialProducts}
      mode="edit"
      purchaseId={purchase.id}
      purchaseCode={purchase.code}
      initialValues={{
        supplierId: purchase.supplierId,
        warehouseId: purchase.warehouseId,
        discount: Number(purchase.discount),
        vatRate: Number(purchase.vatRate),
        invoiceNumber: purchase.invoiceNumber ?? "",
        amountPaid: Number(purchase.amountPaid),
        note: purchase.note ?? "",
        items: purchase.items.map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitCost: Number(i.unitCost),
          discount: Number(i.discount),
        })),
      }}
    />
  );
}

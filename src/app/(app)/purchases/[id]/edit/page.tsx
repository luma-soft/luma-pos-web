import { notFound } from "next/navigation";
import { getPurchase, getPurchaseFormOptions, getPurchaseProductRowsByIds } from "@/lib/data/inventory";
import { PurchaseForm } from "../../new/purchase-form";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const purchase = await getPurchase(id).catch(() => null);
  if (!purchase || (purchase.status !== "received" && purchase.status !== "draft")) notFound();

  const [options, initialProducts] = await Promise.all([
    getPurchaseFormOptions(),
    getPurchaseProductRowsByIds(purchase.items.map((i) => i.productId)),
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

import { notFound } from "next/navigation";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPurchaseReturn, getPurchaseReturnFormOptions } from "@/lib/data/purchase-returns";
import { PurchaseReturnForm } from "../../new/purchase-return-form";
export default async function EditPurchaseReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { storeId } = await requireStoreContext();
  const [initial, options] = await Promise.all([getPurchaseReturn(storeId, id), getPurchaseReturnFormOptions(storeId)]);
  if (!initial) notFound();
  return <PurchaseReturnForm initial={initial} options={options} />;
}

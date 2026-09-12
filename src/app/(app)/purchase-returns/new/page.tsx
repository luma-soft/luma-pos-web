import { getPurchaseReturnFormOptions } from "@/lib/data/purchase-returns";
import { PurchaseReturnForm } from "./purchase-return-form";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPurchase } from "@/lib/data/inventory";

export default async function NewPurchaseReturnPage({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string }> }) {
  const context = await requireStoreContext();
  const options = await getPurchaseReturnFormOptions(context.storeId);
  const params = await searchParams;
  const initialPurchase = params.purchaseOrderId ? await getPurchase(context.storeId, params.purchaseOrderId) : null;
  return <PurchaseReturnForm options={options} initialPurchase={initialPurchase} />;
}

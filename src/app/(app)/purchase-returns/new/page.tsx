import { getPurchaseReturnFormOptions } from "@/lib/data/purchase-returns";
import { PurchaseReturnForm } from "./purchase-return-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export default async function NewPurchaseReturnPage() {
  const context = await requireStoreContext();
  const options = await getPurchaseReturnFormOptions(context.storeId);
  return <PurchaseReturnForm options={options} />;
}

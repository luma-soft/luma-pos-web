import { notFound } from "next/navigation";
import { PurchaseDetailModal } from "@/app/(app)/inventory/tabs/purchase-detail-modal";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPurchase } from "@/lib/data/inventory";
import { getPrintTemplatesForDoc } from "@/lib/print/template";

interface Props {
  params: Promise<{ catchAll: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PurchaseModalCatchAll({ params, searchParams }: Props) {
  const [{ catchAll }, query] = await Promise.all([params, searchParams]);
  if (catchAll.length === 1 && catchAll[0] === "inventory" && query.tab === "purchases") {
    return null;
  }

  const purchaseId =
    typeof query.detailPurchaseId === "string" ? query.detailPurchaseId : null;
  if (!purchaseId) return null;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId)) {
    notFound();
  }

  const context = await requireStoreContext();
  const [purchase, printTemplates] = await Promise.all([
    getPurchase(context.storeId, purchaseId).catch(() => null),
    getPrintTemplatesForDoc(context.storeId, "purchase"),
  ]);
  if (!purchase) notFound();

  return (
    <PurchaseDetailModal purchase={purchase} printTemplates={printTemplates} />
  );
}

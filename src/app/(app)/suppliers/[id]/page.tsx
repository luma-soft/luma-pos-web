import { notFound } from "next/navigation";
import { getSupplier, getSupplierPurchases } from "@/lib/data/partners";
import { SupplierDetailClient } from "./supplier-detail";
import { requireStoreContext } from "@/lib/auth/store-context";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SupplierDetailPage({ params }: Props) {
  const { id } = await params;
  const context = await requireStoreContext();
  const [supplier, purchases] = await Promise.all([
    getSupplier(context.storeId, id),
    getSupplierPurchases(context.storeId, id),
  ]);
  if (!supplier) notFound();
  return <SupplierDetailClient supplier={supplier} purchases={purchases} />;
}

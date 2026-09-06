import { notFound } from "next/navigation";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getInternalUseIssue } from "@/lib/data/internal-use";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { InternalUseForm } from "../../../inventory/internal-use-form";
export default async function EditInternalUsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { storeId } = await requireStoreContext();
  const initial = await getInternalUseIssue(storeId, id);
  if (!initial) notFound();
  return <div className="min-h-full flex flex-col bg-canvas lg:h-dvh">
    <MobileDetailHeader flush backHref="/inventory?tab=internal" backLabel="Quay lại" title={`Sửa phiếu ${initial.code}`} />
    <InternalUseForm initial={initial} warehouse={initial.warehouseId ? { id: initial.warehouseId, name: initial.warehouseName ?? "Kho", isDefault: true } : null} />
  </div>;
}

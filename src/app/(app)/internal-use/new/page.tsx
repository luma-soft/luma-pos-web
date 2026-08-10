import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { getAuthoritativeInternalUseWarehouse } from "@/lib/data/internal-use";
import { InternalUseForm } from "../../inventory/internal-use-form";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function NewInternalUsePage() {
  const context = await requireStoreContext();
  const [t, warehouse] = await Promise.all([
    getTranslations(),
    getAuthoritativeInternalUseWarehouse(context.storeId),
  ]);

  return (
    <div className="min-h-full flex flex-col bg-canvas lg:h-dvh">
      <MobileDetailHeader
        flush
        backHref={`${Routes.Inventory}?tab=internal`}
        backLabel={t("common.back")}
        title={t("internalUse.formTitle")}
      />

      <InternalUseForm warehouse={warehouse} />
    </div>
  );
}

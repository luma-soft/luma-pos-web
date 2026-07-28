import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { InternalUseForm } from "../../inventory/internal-use-form";

export const dynamic = "force-dynamic";

export default async function NewInternalUsePage() {
  const t = await getTranslations();

  return (
    <div className="h-dvh flex flex-col bg-canvas">
      <MobileDetailHeader
        flush
        backHref={`${Routes.Inventory}?tab=internal`}
        backLabel={t("common.back")}
        title={t("internalUse.formTitle")}
      />

      <InternalUseForm />
    </div>
  );
}

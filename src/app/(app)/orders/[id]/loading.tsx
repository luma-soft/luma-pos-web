import { useTranslations } from "next-intl";
import { MobileDocumentDetailSkeleton } from "@/components/mobile-skeletons";
import AppLoading from "../../loading";

/** Invoice detail: LumaDocumentDetailSkeleton on phones, the shared page skeleton on desktop. */
export default function OrderDetailLoading() {
  const t = useTranslations();
  return (
    <>
      <MobileDocumentDetailSkeleton label={t("common.loading")} />
      <div className="max-lg:hidden"><AppLoading /></div>
    </>
  );
}

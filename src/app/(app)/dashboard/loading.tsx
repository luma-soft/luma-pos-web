import { useTranslations } from "next-intl";
import { MobileOverviewSkeleton } from "@/components/mobile-skeletons";
import AppLoading from "../loading";

/** Overview: DashboardSummarySkeletonView on phones, the shared page skeleton on desktop. */
export default function DashboardLoading() {
  const t = useTranslations();
  return (
    <>
      <MobileOverviewSkeleton label={t("common.loading")} />
      <div className="max-lg:hidden"><AppLoading /></div>
    </>
  );
}

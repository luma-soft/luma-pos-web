import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { SHIFT_MANAGEMENT_UI_ENABLED } from "@/lib/features";
import { CashbookTab } from "./tabs/cashbook";
import { ShiftsTab } from "./tabs/shifts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinanceSummaryMobile } from "./tabs/finance-summary-mobile";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "cashbook", labelKey: "nav.cashbook" },
  ...(SHIFT_MANAGEMENT_UI_ENABLED ? [{ tab: "shifts", labelKey: "nav.shifts" }] : []),
];

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "cashbook";
  // Phones: NativeFinanceOperationsView — back, centred title, Tài chính | Sổ quỹ segments.
  const phoneTab = tab === "summary" ? "summary" : "cashbook";

  if (tab === "einvoices") {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) usp.set(key, value);
    usp.set("tab", "einvoices");
    redirect(`${Routes.Sales}?${usp.toString()}`);
  }

  if (tab === "shifts" && !SHIFT_MANAGEMENT_UI_ENABLED) {
    redirect(Routes.Finance);
  }

  return (
    <div className="p-4 sm:p-6 max-lg:pt-0">
      <div className="-mx-4 mb-4 bg-canvas px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:hidden">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center">
          <Link href={Routes.More} aria-label={t("common.back")} data-button-radius="pill" className="grid size-11 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)]">
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <h1 className="text-center text-[17px] font-semibold">{t("mobile.finance.title")}</h1>
          <span aria-hidden="true" />
        </div>
        <nav className="mt-3 grid grid-cols-2 rounded-full bg-ios-accent/10 p-1">
          {(["summary", "cashbook"] as const).map((key) => (
            <Link key={key} href={`${Routes.Finance}?tab=${key}`} data-button-radius="pill" aria-current={phoneTab === key ? "page" : undefined}
              className={cn("grid min-h-10 place-items-center rounded-full text-[17px]", phoneTab === key ? "bg-ios-accent font-semibold text-white" : "text-ios-label")}>
              {t(key === "summary" ? "mobile.finance.tabSummary" : "mobile.finance.tabCashbook")}
            </Link>
          ))}
        </nav>
      </div>
      <div className="sticky top-0 z-20 max-lg:hidden -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.groups.finance")} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5"><GroupTabs base={Routes.Finance} items={TABS} edgeToEdge={false} mobileSegmented /></div>
      </div>

      {tab === "summary" ? <FinanceSummaryMobile />
        : tab === "shifts" && SHIFT_MANAGEMENT_UI_ENABLED
        ? <ShiftsTab />
        : <CashbookTab searchParams={params} />}
    </div>
  );
}

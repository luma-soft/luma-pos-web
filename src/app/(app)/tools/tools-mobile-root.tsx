import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, SquareFunction, Tag, type LucideIcon } from "lucide-react";
import { MobileListSection, mobileListRowClass } from "@/components/mobile-ui";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const circle = "grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10";

/** iOS 26 navigation bar used by the tools screens on phones. */
export async function ToolsMobileNavBar({ title, backHref }: { title: string; backHref: string }) {
  const t = await getTranslations();
  return (
    <header className="sticky top-0 z-20 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 bg-canvas/85 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl md:hidden print:hidden">
      <Link href={backHref} aria-label={t("common.back")} data-button-radius="pill" className={`${circle} text-ios-label`}>
        <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
      </Link>
      <h1 className="truncate text-center text-[17px] font-semibold">{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}

function ToolRow({ href, icon: Icon, tint, title, subtitle }: { href: string; icon: LucideIcon; tint: string; title: string; subtitle: string }) {
  return (
    <Link href={href} className={mobileListRowClass}>
      <span className={cn("grid size-[38px] shrink-0 place-items-center rounded-[10px]", tint)}>
        <Icon className="size-[22px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex min-h-[80px] min-w-0 flex-1 items-center gap-2 border-b border-border py-3 pr-ios-inset group-last:border-b-0">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold leading-[22px]">{title}</span>
          <span className="mt-1 block text-[15px] leading-5 text-ios-label-secondary">{subtitle}</span>
        </span>
        <ChevronRight className="size-[17px] shrink-0 text-ios-label-tertiary" strokeWidth={2.5} aria-hidden="true" />
      </span>
    </Link>
  );
}

/** NativeToolsView on phones: "Tính toán" and "In ấn" groups that push each tool. */
export async function ToolsMobileRoot() {
  const t = await getTranslations("toolsCenter");
  return (
    <div className="min-h-full bg-canvas md:hidden">
      <ToolsMobileNavBar title={t("title")} backHref={Routes.More} />
      <div className="space-y-ios-section px-ios-inset pb-6 pt-2 [&_h2]:px-ios-inset [&_h2]:text-[17px] [&_h2]:font-normal">
        <MobileListSection title={t("groups.calculation")}>
          <ToolRow href={`${Routes.Tools}?tool=tile`} icon={SquareFunction} tint="bg-cyan-500/12 text-cyan-500" title={t("items.tileCalculator")} subtitle={t("tileHint")} />
        </MobileListSection>
        <MobileListSection title={t("groups.printing")}>
          <ToolRow href={Routes.ElectricalLabels} icon={Tag} tint="bg-ios-orange/12 text-ios-orange" title={t("items.electricalLabels")} subtitle={t("labelsHint")} />
        </MobileListSection>
      </div>
    </div>
  );
}

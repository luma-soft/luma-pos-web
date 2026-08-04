"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const PRIMARY = [
  { tab: "products", labelKey: "nav.products" },
  { tab: "purchases", labelKey: "nav.purchases" },
  { tab: "stock", labelKey: "inventory.title" },
] as const;

const MORE = [
  { tab: "pricing", labelKey: "nav.pricing" },
  { tab: "purchase-returns", labelKey: "purchaseReturns.title" },
  { tab: "internal", labelKey: "nav.internalUse" },
  { tab: "categories", labelKey: "categories.title" },
] as const;

export function InventoryNavigation({ activeTab }: { activeTab: string }) {
  const t = useTranslations();
  const moreActive = MORE.some((item) => item.tab === activeTab);
  const itemClass = "inline-flex h-10 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

  return (
    <nav className="flex items-center gap-1 overflow-visible" aria-label={t("nav.groups.inventory")}>
      {PRIMARY.map((item) => (
        <Link
          key={item.tab}
          href={`${Routes.Inventory}?tab=${item.tab}`}
          aria-current={activeTab === item.tab ? "page" : undefined}
          className={cn(itemClass, activeTab === item.tab ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" : "text-slate-500 hover:bg-surface-2 hover:text-slate-900")}
        >
          {t(item.labelKey)}
        </Link>
      ))}
      <details className="group relative">
        <summary className={cn(itemClass, "cursor-pointer list-none gap-1.5 [&::-webkit-details-marker]:hidden", moreActive ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" : "text-slate-500 hover:bg-surface-2 hover:text-slate-900")}>
          {t("nav.more")}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-e3">
          {MORE.map((item) => (
            <Link key={item.tab} href={`${Routes.Inventory}?tab=${item.tab}`} className={cn("block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-surface-2", activeTab === item.tab ? "text-primary-700" : "text-slate-700 dark:text-slate-200")}>{t(item.labelKey)}</Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const TABS = [
  { tab: "products", labelKey: "nav.products" },
  { tab: "purchases", labelKey: "nav.purchases" },
  { tab: "stock", labelKey: "inventory.title" },
  { tab: "pricing", labelKey: "nav.pricing" },
  { tab: "purchase-returns", labelKey: "purchaseReturns.title" },
  { tab: "internal", labelKey: "nav.internalUse" },
  { tab: "stocktakes", labelKey: "nav.stocktakes" },
] as const;

export function InventoryNavigation({ activeTab }: { activeTab: string }) {
  const t = useTranslations();
  const itemClass = "relative inline-flex h-10 shrink-0 items-center px-3 text-sm font-semibold transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

  return (
    <nav className="flex w-max min-w-full items-center gap-1" aria-label={t("nav.groups.inventory")}>
      {TABS.map((item) => (
        <Link
          key={item.tab}
          href={`${Routes.Inventory}?tab=${item.tab}`}
          aria-current={activeTab === item.tab ? "page" : undefined}
          className={cn(itemClass, activeTab === item.tab ? "text-primary-700 after:bg-primary-600 dark:text-primary-300" : "text-slate-500 hover:text-slate-900")}
        >
          {t(item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}

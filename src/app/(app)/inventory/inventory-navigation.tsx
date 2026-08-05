"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const TABS = [
  { tab: "products", labelKey: "nav.products" },
  { tab: "purchases", labelKey: "nav.purchases" },
  { tab: "stock", labelKey: "inventory.warehouseTab" },
] as const;

const MORE_TABS = [
  { tab: "pricing", labelKey: "nav.pricing" },
  { tab: "purchase-returns", labelKey: "purchaseReturns.title" },
  { tab: "internal", labelKey: "nav.internalUse" },
  { tab: "stocktakes", labelKey: "nav.stocktakes" },
] as const;

export function InventoryNavigation({ activeTab }: { activeTab: string }) {
  const t = useTranslations();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const moreActive = MORE_TABS.some((item) => item.tab === activeTab);
  const itemClass =
    "relative inline-flex h-10 shrink-0 items-center px-3 text-sm font-semibold transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeKey);
    };
  }, [open]);

  return (
    <nav
      className="flex w-max min-w-full items-center gap-1"
      aria-label={t("nav.groups.inventory")}
    >
      {TABS.map((item) => (
        <Link
          key={item.tab}
          href={`${Routes.Inventory}?tab=${item.tab}`}
          aria-current={activeTab === item.tab ? "page" : undefined}
          className={cn(
            itemClass,
            activeTab === item.tab
              ? "text-primary-700 after:bg-primary-600 dark:text-primary-300"
              : "text-slate-500 hover:text-slate-900",
          )}
        >
          {t(item.labelKey)}
        </Link>
      ))}
      <div ref={root} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            itemClass,
            moreActive
              ? "text-primary-700 after:bg-primary-600 dark:text-primary-300"
              : "text-slate-500 hover:text-slate-900",
          )}
        >
          {t("common.more")}
          <ChevronDown className={cn("ml-2 h-4 w-4 transition", open && "rotate-180")} />
        </button>
        {open && (
          <div role="menu" className="absolute left-0 top-[calc(100%+8px)] z-50 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-e3">
            {MORE_TABS.map((item) => (
              <Link
                key={item.tab}
                role="menuitem"
                href={`${Routes.Inventory}?tab=${item.tab}`}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-lg px-3 py-2.5 text-sm font-semibold hover:bg-surface-2",
                  activeTab === item.tab
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
                    : "text-slate-700 dark:text-slate-200",
                )}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, ShoppingCart, Warehouse, Users, Wallet,
  BarChart3, Settings, FileText, Utensils,
} from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

type Item = { href: string; icon: React.ComponentType<{ className?: string }>; key: string; newTab?: boolean };
type Group = { labelKey: string; items: Item[] };

const GROUPS: Group[] = [
  {
    labelKey: "nav.groups.overview",
    items: [
      { href: Routes.Dashboard, icon: LayoutDashboard, key: "nav.dashboard" },
      { href: Routes.POS, icon: ShoppingCart, key: "nav.pos", newTab: true },
    ],
  },
  {
    labelKey: "nav.groups.manage",
    items: [
      { href: Routes.Sales, icon: FileText, key: "nav.groups.sales" },
      { href: Routes.Inventory, icon: Warehouse, key: "nav.groups.inventory" },
      { href: Routes.Partners, icon: Users, key: "nav.groups.partners" },
      { href: Routes.Finance, icon: Wallet, key: "nav.groups.finance" },
    ],
  },
  {
    labelKey: "nav.groups.system",
    items: [
      { href: Routes.Reports, icon: BarChart3, key: "nav.reports" },
      { href: Routes.Settings, icon: Settings, key: "nav.settings" },
    ],
  },
];

/** Sidebar điều hướng có chữ — dùng cho cả desktop (cố định) và drawer mobile. */
export function AppNav({ industry }: { industry?: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const isFnb = industry === "restaurant" || industry === "cafe";
  const groups = isFnb
    ? GROUPS.map((g) => g.labelKey === "nav.groups.manage"
        ? { ...g, items: [...g.items, { href: "/tables", icon: Utensils, key: "nav.tables" } as Item] }
        : g)
    : GROUPS;

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 text-sm">
      {groups.map((g) => (
        <div key={g.labelKey}>
          <div className="px-3 pt-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">
            {t(g.labelKey)}
          </div>
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  target={item.newTab ? "_blank" : undefined}
                  onClick={() => { document.documentElement.dataset.mobilenav = ""; }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium transition",
                    active
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-400"
                      : "text-slate-500 dark:text-slate-400 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200"
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span>{t(item.key)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

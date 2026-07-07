"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, ShoppingCart, Warehouse, Users, Wallet,
  BarChart3, Settings, FileText, Utensils, Sparkles, ChefHat, Bell, Store,
} from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";

type Item = { href: string; icon: React.ComponentType<{ className?: string }>; key: string; badge?: "notifications" };
type Group = { labelKey: string; items: Item[] };

const GROUPS: Group[] = [
  {
    labelKey: "nav.groups.overview",
    items: [
      { href: Routes.Dashboard, icon: LayoutDashboard, key: "nav.dashboard" },
      { href: Routes.Notifications, icon: Bell, key: "nav.notifications", badge: "notifications" },
      { href: Routes.Reports, icon: BarChart3, key: "nav.reports" },
      { href: Routes.POS, icon: ShoppingCart, key: "nav.pos" },
    ],
  },
  {
    labelKey: "nav.groups.manage",
    items: [
      { href: Routes.Sales, icon: FileText, key: "nav.groups.sales" },
      { href: Routes.Inventory, icon: Warehouse, key: "nav.groups.inventory" },
      { href: Routes.Shopee, icon: Store, key: "nav.shopee" },
      { href: Routes.Partners, icon: Users, key: "nav.groups.partners" },
      { href: Routes.Finance, icon: Wallet, key: "nav.groups.finance" },
    ],
  },
  {
    labelKey: "nav.groups.system",
    items: [
      { href: "/ai", icon: Sparkles, key: "nav.ai" },
      { href: Routes.Settings, icon: Settings, key: "nav.settings" },
    ],
  },
];

/** Sidebar điều hướng có chữ — dùng cho cả desktop (cố định) và drawer mobile. */
export function AppNav({
  industry,
  notificationCount = 0,
  aiConfigured = false,
}: {
  industry?: string;
  notificationCount?: number;
  aiConfigured?: boolean;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const isFnb = industry === "restaurant" || industry === "cafe";
  const groupsBase = GROUPS.map((group) => group.labelKey === "nav.groups.system"
    ? { ...group, items: group.items.filter((item) => aiConfigured || item.href !== "/ai") }
    : group);
  const groups = isFnb
    ? groupsBase.map((g) => g.labelKey === "nav.groups.manage"
        ? { ...g, items: [...g.items, { href: "/tables", icon: Utensils, key: "nav.tables" } as Item, { href: "/kds", icon: ChefHat, key: "nav.kds" } as Item] }
        : g)
    : groupsBase;

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 text-sm">
      {groups.map((g) => (
        <div key={g.labelKey}>
          <Text
            as="div"
            variant="muted"
            weight="bold"
            className="px-3 pt-4 pb-1.5 text-[10.5px] uppercase tracking-wider"
            text={t(g.labelKey)}
          />
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => { document.documentElement.dataset.mobilenav = ""; }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium transition",
                    active
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-400"
                      : "text-slate-500 dark:text-slate-400 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200"
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <Text as="span" size="sm" weight="medium" className="min-w-0 flex-1 truncate" text={t(item.key)} />
                  {item.badge === "notifications" && notificationCount > 0 && (
                    <span
                      aria-label={t("nav.notificationsBadge", { count: notificationCount })}
                      className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-er px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white"
                    >
                      {notificationCount > 99 ? "99+" : notificationCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

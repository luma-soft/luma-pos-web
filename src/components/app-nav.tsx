"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, ShoppingCart, Package, Users, Truck,
  FileText, Warehouse, BarChart3, Settings, FileSpreadsheet,
  Wallet, Building2, Percent, FileCheck2, PackageMinus,
  Tags, ClipboardCheck,
} from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { RailControls } from "@/components/rail-controls";
import type { Theme, Mode } from "@/lib/theme/config";

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
    labelKey: "nav.groups.sales",
    items: [
      { href: Routes.Orders, icon: FileText, key: "nav.orders" },
      { href: Routes.Quotes, icon: FileSpreadsheet, key: "nav.quotes" },
      { href: Routes.Promotions, icon: Percent, key: "nav.promotions" },
    ],
  },
  {
    labelKey: "nav.groups.inventory",
    items: [
      { href: Routes.Products, icon: Package, key: "nav.products" },
      { href: Routes.Pricing, icon: Tags, key: "nav.pricing" },
      { href: Routes.Inventory, icon: Warehouse, key: "nav.inventory" },
      { href: Routes.Stocktakes, icon: ClipboardCheck, key: "nav.stocktakes" },
      { href: Routes.Purchases, icon: Truck, key: "nav.purchases" },
    ],
  },
  {
    labelKey: "nav.groups.partners",
    items: [
      { href: Routes.Customers, icon: Users, key: "nav.customers" },
      { href: Routes.Projects, icon: Building2, key: "nav.projects" },
      { href: Routes.Suppliers, icon: PackageMinus, key: "nav.suppliers" },
    ],
  },
  {
    labelKey: "nav.groups.finance",
    items: [
      { href: Routes.Cashbook, icon: Wallet, key: "nav.cashbook" },
      { href: Routes.EInvoices, icon: FileCheck2, key: "nav.einvoices" },
    ],
  },
  {
    labelKey: "nav.groups.system",
    items: [
      { href: Routes.Reports, icon: BarChart3, key: "nav.reports" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

/* ── Desktop: rail icon 64px nền tối ── */
export function AppRail({ theme, mode }: { theme: Theme; mode: Mode }) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-16 shrink-0 bg-nav flex-col items-center py-3.5 sticky top-0 h-screen">
      <Link href={Routes.Dashboard} className="w-10 h-10 rounded-[10px] bg-primary-600 grid place-items-center text-white text-[15px] font-extrabold tracking-tight mb-3">
        L
      </Link>

      <nav className="flex-1 flex flex-col items-center gap-1 overflow-y-auto w-full [&::-webkit-scrollbar]:w-0">
        {GROUPS.map((g, gi) => (
          <div key={g.labelKey} className="flex flex-col items-center gap-1 w-full">
            {gi > 0 && <span className="h-px w-7 bg-white/10 my-1" />}
            {g.items.map((item) => (
              <RailLink key={item.href} item={item} active={isActive(pathname, item.href)} label={t(item.key)} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col items-center gap-1 mt-2">
        <span className="h-px w-7 bg-white/10 my-1" />
        <RailLink
          item={{ href: Routes.Settings, icon: Settings, key: "nav.settings" }}
          active={isActive(pathname, Routes.Settings)}
          label={t("nav.settings")}
        />
        <RailControls theme={theme} mode={mode} />
      </div>
    </aside>
  );
}

function RailLink({ item, active, label }: { item: Item; active: boolean; label: string }) {
  return (
    <Link
      href={item.href}
      target={item.newTab ? "_blank" : undefined}
      title={label}
      aria-label={label}
      className={cn(
        "group relative w-11 h-11 rounded-[10px] grid place-items-center transition-colors",
        active
          ? "bg-[rgba(45,212,191,0.15)] text-[#2DD4BF]"
          : "text-[rgba(250,250,248,0.4)] hover:bg-white/[0.07] hover:text-[rgba(250,250,248,0.85)]"
      )}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-5 bg-[#2DD4BF] rounded-r" />}
      <item.icon className="w-5 h-5" />
      <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-nav text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-70 shadow-e2">
        {label}
      </span>
    </Link>
  );
}

/* ── Mobile: drawer điều hướng có chữ ── */
export function AppDrawerNav() {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 text-sm">
      {GROUPS.map((g) => (
        <div key={g.labelKey}>
          <div className="px-3 pt-4 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">
            {t(g.labelKey)}
          </div>
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
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

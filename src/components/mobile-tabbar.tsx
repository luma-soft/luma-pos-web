"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ellipsis, FileText, House, Package, ShoppingCart, type LucideIcon } from "lucide-react";
import { Routes } from "@/lib/routes";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type Tab = {
  id: "overview" | "sales" | "inventory" | "invoices" | "more";
  href: string;
  labelKey: "nav.dashboard" | "nav.mobileSales" | "nav.mobileInventory" | "nav.mobileOrders" | "nav.more";
  icon: LucideIcon;
};

// The section order and icons mirror AppSection.swift in the native iOS app.
// Keep these route groups presentation-only: server-side authorization remains authoritative.
const TABS: readonly Tab[] = [
  { id: "overview", href: Routes.Dashboard, labelKey: "nav.dashboard", icon: House },
  { id: "sales", href: Routes.POS, labelKey: "nav.mobileSales", icon: ShoppingCart },
  { id: "inventory", href: Routes.Inventory, labelKey: "nav.mobileInventory", icon: Package },
  { id: "invoices", href: Routes.Sales, labelKey: "nav.mobileOrders", icon: FileText },
  { id: "more", href: Routes.More, labelKey: "nav.more", icon: Ellipsis },
];

export function MobileTabBar({ role }: { role: Role }) {
  const t = useTranslations();
  const pathname = usePathname();
  const isTechnician = role === "technician";
  const matches = (route: string) => pathname === route || pathname.startsWith(`${route}/`);

  const sectionActive: Record<Tab["id"], boolean> = {
    overview: matches(Routes.Dashboard),
    sales: matches(Routes.POS),
    inventory: [
      Routes.Inventory, Routes.Products, Routes.Purchases, Routes.PurchaseReturns,
      Routes.Stocktakes, Routes.Pricing, "/internal-use",
    ].some(matches),
    invoices: [
      Routes.Sales, Routes.Orders, Routes.Quotes, Routes.EInvoices, "/returns", "/bookings", "/invoices",
    ].some(matches),
    more: false,
  };
  sectionActive.more = isTechnician ||
    !sectionActive.overview && !sectionActive.sales &&
    !sectionActive.inventory && !sectionActive.invoices;

  return (
    <nav
      aria-label={t("common.primaryNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-stretch border-t border-border bg-surface/98 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {(isTechnician ? TABS.filter((tab) => tab.id === "more") : TABS).map((tab) => {
        const active = sectionActive[tab.id];
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 px-1 py-1 text-[11px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 active:scale-[0.98]",
              active ? "text-primary-700 dark:text-primary-300" : "text-slate-500 dark:text-slate-400",
            )}
          >
            <Icon className="h-[23px] w-[23px] shrink-0" strokeWidth={active ? 2.35 : 1.9} aria-hidden="true" />
            <span className="max-w-full truncate whitespace-nowrap">{t(tab.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

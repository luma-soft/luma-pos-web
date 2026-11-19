"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ellipsis, FileText, House, Package, ShoppingCart, type LucideIcon } from "lucide-react";
import { Routes } from "@/lib/routes";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { useMobileTabBarHideRequested } from "@/components/mobile-tabbar-visibility";

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

/**
 * Tab roots keep the tab bar, like the native tab roots. Every other screen is a
 * pushed sub-screen (all of More's destinations, details, forms), where the
 * native app hides the tab bar.
 */
const TAB_ROOT_ROUTES: readonly string[] = [
  Routes.Dashboard, Routes.POS, Routes.Inventory, Routes.Products, Routes.Purchases, Routes.PurchaseReturns,
  Routes.Stocktakes, Routes.Pricing, "/internal-use",
  Routes.Sales, Routes.Orders, Routes.Quotes, "/returns", "/bookings", "/invoices",
  Routes.More,
];

/**
 * Floating capsule tab bar matching the native iOS 26 tab bar: translucent
 * material, a highlighted pill behind the selected tab, accent-tinted selection
 * and primary-label inactive items.
 */
export function MobileTabBar({ role }: { role: Role }) {
  const t = useTranslations();
  const pathname = usePathname();
  const isTechnician = role === "technician";
  const matches = (route: string) => pathname === route || pathname.startsWith(`${route}/`);
  const hideRequested = useMobileTabBarHideRequested();
  const hidden = hideRequested || !TAB_ROOT_ROUTES.includes(pathname);

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
      aria-hidden={hidden || undefined}
      inert={hidden}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 px-5 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.75rem))] lg:hidden",
        // Slide with the iOS navigation curve, the way a hidden UITabBar moves with a push/pop.
        "transition-[translate,opacity] duration-[350ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        hidden ? "translate-y-[calc(100%+12px)] opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      {/* While hidden, content and bottom bars only keep the home-indicator inset. */}
      {hidden && <style>{":root{--mobile-tabbar-space:env(safe-area-inset-bottom,0px)}"}</style>}
      <div className="pointer-events-auto mx-auto flex h-[62px] max-w-[480px] items-stretch gap-0.5 rounded-full border border-white/60 bg-white/72 p-1 font-ios shadow-[0_8px_30px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.06)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-[#1C1C1E]/78 dark:shadow-[0_8px_30px_rgb(0_0_0/0.5)]">
        {(isTechnician ? TABS.filter((tab) => tab.id === "more") : TABS).map((tab) => {
          const active = sectionActive[tab.id];
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              data-button-radius="pill"
              className={cn(
                "flex min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[10.5px] font-semibold leading-tight transition-[background-color,color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ios-accent active:scale-[0.96]",
                active
                  ? "bg-black/[0.06] text-ios-accent dark:bg-white/[0.1]"
                  : "text-ios-label",
              )}
            >
              <Icon className="h-[22px] w-[22px] shrink-0" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
              <span className="max-w-full truncate whitespace-nowrap">{t(tab.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

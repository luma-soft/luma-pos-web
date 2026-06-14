"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, ShoppingCart, Package, Users, Menu } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Thanh tab dưới cùng — chỉ hiện trên mobile (giống design mobile app). */
export function MobileTabBar() {
  const t = useTranslations();
  const pathname = usePathname();
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const openDrawer = () => { document.documentElement.dataset.mobilenav = "open"; };

  const item = "flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10.5px] font-semibold";
  const on = "text-primary-600";
  const off = "text-slate-400";

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-surface border-t border-border flex items-stretch pb-[env(safe-area-inset-bottom)]">
      <Link href={Routes.Dashboard} className={cn(item, is(Routes.Dashboard) ? on : off)}>
        <LayoutDashboard className="w-5 h-5" />{t("nav.dashboard")}
      </Link>
      <Link href={Routes.POS} target="_blank" className={cn(item, off)}>
        <ShoppingCart className="w-5 h-5" />{t("nav.pos")}
      </Link>
      <Link href={Routes.Products} className={cn(item, is(Routes.Products) ? on : off)}>
        <Package className="w-5 h-5" />{t("nav.products")}
      </Link>
      <Link href={Routes.Customers} className={cn(item, is(Routes.Customers) ? on : off)}>
        <Users className="w-5 h-5" />{t("nav.customers")}
      </Link>
      <button onClick={openDrawer} className={cn(item, off)}>
        <Menu className="w-5 h-5" />{t("nav.more")}
      </button>
    </nav>
  );
}

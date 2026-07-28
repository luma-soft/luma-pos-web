"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, ShoppingCart, Warehouse, FileText, Menu } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";

/** Thanh tab dưới cùng — chỉ hiện trên mobile (giống design mobile app). */
export function MobileTabBar() {
  const t = useTranslations();
  const pathname = usePathname();
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const item = "group min-h-11 min-w-11 flex-1 flex flex-col items-center justify-center gap-[3px] px-0.5 pt-1 text-[9px] font-bold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 active:scale-[0.98]";
  const on = "text-primary-600";
  const off = "text-slate-400 dark:text-slate-500";

  return (
    <nav aria-label={t("common.primaryNavigation")} className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-[calc(3.75rem+env(safe-area-inset-bottom))] bg-surface/98 border-t border-border flex items-stretch pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <Link href={Routes.Dashboard} aria-current={is(Routes.Dashboard) ? "page" : undefined} className={cn(item, is(Routes.Dashboard) ? on : off)}>
        <LayoutDashboard className="w-[22px] h-[22px]" strokeWidth={is(Routes.Dashboard) ? 2.3 : 2} />
        <Text as="span" weight="bold" className="max-w-full truncate whitespace-nowrap text-current text-[9px]" text={t("nav.dashboard")} />
      </Link>
      <Link href={Routes.POS} aria-current={is(Routes.POS) ? "page" : undefined} className={cn(item, is(Routes.POS) ? on : off)}>
        <ShoppingCart className="w-[22px] h-[22px]" strokeWidth={is(Routes.POS) ? 2.3 : 2} />
        <Text as="span" weight="bold" className="max-w-full truncate whitespace-nowrap text-current text-[9px]" text={t("nav.mobileSales")} />
      </Link>
      <Link href={Routes.Inventory} aria-current={is(Routes.Inventory) || is(Routes.Products) ? "page" : undefined} className={cn(item, is(Routes.Inventory) || is(Routes.Products) ? on : off)}>
        <Warehouse className="w-[22px] h-[22px]" strokeWidth={is(Routes.Inventory) || is(Routes.Products) ? 2.3 : 2} />
        <Text as="span" weight="bold" className="max-w-full truncate whitespace-nowrap text-current text-[9px]" text={t("nav.mobileInventory")} />
      </Link>
      <Link href={Routes.Sales} aria-current={is(Routes.Sales) ? "page" : undefined} className={cn(item, is(Routes.Sales) ? on : off)}>
        <FileText className="w-[22px] h-[22px]" strokeWidth={is(Routes.Sales) ? 2.3 : 2} />
        <Text as="span" weight="bold" className="max-w-full truncate whitespace-nowrap text-current text-[9px]" text={t("nav.mobileOrders")} />
      </Link>
      <Link href={Routes.More} aria-current={is(Routes.More) ? "page" : undefined} className={cn(item, is(Routes.More) ? on : off)}>
        <Menu className="w-[22px] h-[22px]" strokeWidth={is(Routes.More) ? 2.3 : 2} />
        <Text as="span" weight="bold" className="max-w-full truncate whitespace-nowrap text-current text-[9px]" text={t("nav.more")} />
      </Link>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, ShoppingCart, Package, Users, Menu } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

/** Thanh tab dưới cùng — chỉ hiện trên mobile (giống design mobile app). */
export function MobileTabBar() {
  const t = useTranslations();
  const pathname = usePathname();
  const is = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const openDrawer = () => { document.documentElement.dataset.mobilenav = "open"; };

  const item = "min-w-0 flex-1 flex flex-col items-center justify-center gap-1 px-0.5 pt-1 text-[10px] font-semibold leading-none";
  const on = "text-primary-600";
  const off = "text-slate-400";

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-[calc(3.5rem+env(safe-area-inset-bottom))] bg-surface border-t border-border flex items-stretch pb-[env(safe-area-inset-bottom)]">
      <Link href={Routes.Dashboard} className={cn(item, is(Routes.Dashboard) ? on : off)}>
        <LayoutDashboard className="w-5 h-5" />
        <Text as="span" weight="semibold" className="max-w-full truncate whitespace-nowrap text-current text-[10px]" text={t("nav.dashboard")} />
      </Link>
      <Link href={Routes.POS} aria-label={t("nav.pos")} className={cn(item, off)}>
        <ShoppingCart className="w-5 h-5" />
        <Text as="span" aria-hidden="true" weight="semibold" className="max-w-full truncate whitespace-nowrap text-current text-[10px]" text="POS" />
      </Link>
      <Link href={Routes.Products} className={cn(item, is(Routes.Products) ? on : off)}>
        <Package className="w-5 h-5" />
        <Text as="span" weight="semibold" className="max-w-full truncate whitespace-nowrap text-current text-[10px]" text={t("nav.products")} />
      </Link>
      <Link href={Routes.Customers} className={cn(item, is(Routes.Customers) ? on : off)}>
        <Users className="w-5 h-5" />
        <Text as="span" weight="semibold" className="max-w-full truncate whitespace-nowrap text-current text-[10px]" text={t("nav.customers")} />
      </Link>
      <Button type="button" variant="ghost" onClick={openDrawer} className={cn(item, off, "h-auto rounded-none px-0")}>
        <Menu className="w-5 h-5" />
        <Text as="span" weight="semibold" className="max-w-full truncate whitespace-nowrap text-current text-[10px]" text={t("nav.more")} />
      </Button>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { productCatalogMatches } from "@/lib/product-catalog-explorer";

export function ProductCatalogSwitcher({
  activeView,
  productCount: providedProductCount,
  categoryCount,
}: {
  activeView: "products" | "categories";
  productCount?: number;
  categoryCount?: number;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const catalog = useProductCatalog();
  const productCount = useMemo(() => providedProductCount ?? productCatalogMatches(
    catalog.products,
    catalog.snapshot?.warehouses ?? [],
    { status: "active", view: "grouped" },
  ), [catalog.products, catalog.snapshot?.warehouses, providedProductCount]);
  const resolvedCategoryCount = categoryCount ?? catalog.snapshot?.metadata?.categories.length ?? 0;
  const options = [
    { id: "products", label: t("nav.products"), count: productCount },
    { id: "categories", label: t("categories.title"), count: resolvedCategoryCount },
  ] as const;

  return (
    <nav
      aria-label={t("nav.products")}
      className="mb-4 grid grid-cols-2 gap-1 overflow-hidden rounded-full bg-primary-50/75 p-[3px] dark:bg-primary-950/30 lg:gap-0 lg:rounded-xl lg:border lg:border-border lg:bg-surface lg:p-0"
    >
      {options.map((option) => (
        <Link
          key={option.id}
          href={`${Routes.Inventory}?tab=products&catalog=${option.id}`}
          aria-current={activeView === option.id ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold transition-colors lg:gap-2 lg:rounded-none lg:px-4",
            activeView === option.id
              ? "bg-primary-600 text-white shadow-sm lg:bg-primary-50 lg:text-primary-700 lg:shadow-none lg:dark:bg-primary-950/40 lg:dark:text-primary-300"
              : "text-slate-500 hover:bg-surface-2 hover:text-slate-900",
            "min-w-11 lg:min-w-0",
          )}
        >
          <span>{option.label}</span>
          <span className="text-xs tabular-nums opacity-75">{option.count.toLocaleString(locale)}</span>
        </Link>
      ))}
    </nav>
  );
}

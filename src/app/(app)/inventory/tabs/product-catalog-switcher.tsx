"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export function ProductCatalogSwitcher({
  activeView,
  productCount,
  categoryCount,
}: {
  activeView: "products" | "categories";
  productCount?: number;
  categoryCount?: number;
}) {
  const t = useTranslations();
  const options = [
    { id: "products", label: t("nav.products"), count: productCount },
    { id: "categories", label: t("categories.title"), count: categoryCount },
  ] as const;

  return (
    <nav
      aria-label={t("nav.products")}
      className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface"
    >
      {options.map((option) => (
        <Link
          key={option.id}
          href={`${Routes.Inventory}?tab=products&catalog=${option.id}`}
          aria-current={activeView === option.id ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-2 px-4 text-sm font-semibold transition-colors",
            activeView === option.id
              ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
              : "text-slate-500 hover:bg-surface-2 hover:text-slate-900",
          )}
        >
          <span>{option.label}</span>
          {option.count != null && (
            <span className="text-xs tabular-nums opacity-75">{option.count.toLocaleString()}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

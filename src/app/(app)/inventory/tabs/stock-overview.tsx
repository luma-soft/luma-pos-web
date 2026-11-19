import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronRight,
  ListChecks,
  CircleAlert,
  Minus,
  PackageX,
  type LucideIcon,
} from "lucide-react";
import { Routes } from "@/lib/routes";
import type { InventoryStatusCounts } from "@/lib/data/inventory";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import {
  RecentMovements,
  type MovementItem,
} from "./stock-actions";

type InventoryStockStatus = keyof InventoryStatusCounts;

const STATUS_CARDS: Array<{
  status: InventoryStockStatus;
  icon: LucideIcon;
  tone: "danger" | "warning" | "success";
}> = [
  { status: "negativeStock", icon: Minus, tone: "danger" },
  { status: "outOfStock", icon: PackageX, tone: "danger" },
  { status: "lowStock", icon: CircleAlert, tone: "warning" },
  { status: "inStock", icon: Check, tone: "success" },
];

export function StockOverview({
  totalValue,
  productCount,
  statusCounts,
  movements,
  children,
}: {
  totalValue: number;
  productCount: number;
  statusCounts: InventoryStatusCounts;
  movements: MovementItem[];
  children?: ReactNode;
}) {
  const t = useTranslations();

  return (
    <div
      className="space-y-5"
      data-layout="inventory-stock-overview"
      data-density="compact"
    >
      <section className="grid grid-cols-2 overflow-hidden rounded-card border border-border bg-surface shadow-e1">
        <OverviewMetric
          label={t("inventory.totalValue")}
          value={formatCurrency(totalValue)}
          tone="primary"
        />
        <OverviewMetric
          label={t("inventory.totalProducts")}
          value={formatNumber(productCount)}
        />
      </section>

      <section aria-labelledby="inventory-status-heading">
        <div className="mb-3">
          <h2
            id="inventory-status-heading"
            className="text-base font-bold text-slate-900 dark:text-slate-100"
          >
            {t("inventory.statusSection")}
          </h2>
        </div>

        <div className="grid gap-3 max-lg:grid-cols-2 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_CARDS.map((item) => (
            <StatusCard
              key={item.status}
              status={item.status}
              count={statusCounts[item.status]}
              icon={item.icon}
              tone={item.tone}
            />
          ))}
        </div>
      </section>

      {/* Phones: InventoryStockOverviewView's prominent stocktake button. */}
      <Link
        href={Routes.StocktakeNew}
        className="flex min-h-[52px] items-center justify-center gap-2 rounded-[16px] bg-ios-accent text-[17px] font-semibold text-white active:opacity-80 lg:hidden"
      >
        <ListChecks className="size-5" strokeWidth={2.4} aria-hidden="true" />
        {t("mobile.stocktakes.start")}
      </Link>

      {children}

      <RecentMovements movements={movements} />
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary";
}) {
  return (
    <div className="flex min-h-20 flex-col items-center justify-center border-r border-border px-4 py-3 text-center last:border-r-0">
      <div
        className={cn(
          "font-mono text-xl font-extrabold tabular-nums lg:text-2xl",
          tone === "primary"
            ? "text-primary-700 dark:text-primary-300"
            : "text-slate-950 dark:text-white",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function StatusCard({
  status,
  count,
  icon: Icon,
  tone,
}: {
  status: InventoryStockStatus;
  count: number;
  icon: LucideIcon;
  tone: "danger" | "warning" | "success";
}) {
  const t = useTranslations();
  const href = `${Routes.Inventory}?tab=stock&stockStatus=${status}`;
  const toneClass = {
    danger:
      "border-er/25 bg-er-soft/55 text-er hover:border-er/40 dark:bg-er/10",
    warning:
      "border-warn/30 bg-warn-soft/55 text-warn hover:border-warn/50 dark:bg-warn/10",
    success:
      "border-ok/25 bg-ok-soft/55 text-ok hover:border-ok/40 dark:bg-ok/10",
  }[tone];

  return (
    <Link
      href={href}
      className={cn(
        "group min-h-[116px] rounded-card border p-4 max-lg:rounded-[18px] max-lg:p-3.5 transition duration-150 hover:-translate-y-0.5 hover:shadow-e2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        toneClass,
        "inline-flex min-h-11 min-w-11 flex-col sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11 lg:min-h-[116px] lg:min-w-0",
      )}
    >
      {/* Phones: header row with icon, title and chevron; big count below (2-column grid). */}
      <div className="flex w-full items-center gap-2 lg:hidden">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-current/20 bg-surface/80">
          <Icon className="size-[17px]" strokeWidth={2.4} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-[-0.01em] text-ios-label">{t(`inventory.statusCards.${status}.label`)}</span>
        <ChevronRight className="-mr-1 size-4 shrink-0 text-ios-label-secondary" strokeWidth={2.4} />
      </div>
      <div className="mt-3 text-[26px] font-extrabold leading-none tabular-nums lg:hidden">
        {formatNumber(count)} <span className="text-[13px] font-semibold">SKU</span>
      </div>
      <div className="flex w-full items-center gap-3 max-lg:hidden">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-current/20 bg-surface/65">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t(`inventory.statusCards.${status}.label`)}
          </div>
          <div className="mt-0.5 font-mono text-2xl font-extrabold tabular-nums">
            {formatNumber(count)}{" "}
            <span className="font-sans text-sm font-semibold">SKU</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500 max-lg:mt-2.5 max-lg:text-[13px] max-lg:text-ios-label-secondary">
        {t(`inventory.statusCards.${status}.description`)}
      </p>
    </Link>
  );
}

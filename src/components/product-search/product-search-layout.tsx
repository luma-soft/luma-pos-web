import type { HTMLAttributes, ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { SHOW_WAREHOUSE } from "@/lib/inventory/warehouse-visibility";

export function ProductSearchStockLabel({
  quantity,
  unit,
  unitMultiplier = 1,
  label,
  location,
  className,
}: {
  quantity: number | string;
  unit: string;
  /** Number of base units represented by one displayed unit. */
  unitMultiplier?: number;
  label: string;
  location?: string | null;
  className?: string;
}) {
  const multiplier = Number.isFinite(unitMultiplier) && unitMultiplier > 0 ? unitMultiplier : 1;
  return (
    <div className={cn("text-xs text-slate-400 tabular-nums max-lg:text-[13px] max-lg:leading-[18px] max-lg:text-ios-label-secondary", className)}>
      {label}: {formatNumber(Number(quantity) / multiplier)} {unit}{SHOW_WAREHOUSE && location ? ` · ${location}` : ""}
    </div>
  );
}

/**
 * Product search result row. Phones follow LumaProductSelectionRow / POSProductSearchRow:
 * 104pt row, 40pt thumbnail, and a 124pt trailing column with the price on top and
 * either the quantity stepper (already picked) or a 44pt "+" add tile below.
 * Desktop keeps the compact single-line row.
 */
export function ProductSearchResultLayout({
  selected = false,
  leading,
  summary,
  price,
  controls,
  showAddTile = true,
  desktopPriceWithControls = false,
  addTileIcon = "plus",
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  selected?: boolean;
  leading: ReactNode;
  summary: ReactNode;
  /** Price label; rendered above the trailing control on phones. */
  price?: ReactNode;
  /** Quantity control (or any trailing control) for the row. */
  controls?: ReactNode;
  /** Phones: show the "+" add tile when the row has no control yet. */
  showAddTile?: boolean;
  /** Desktop: keep the price next to the control (POS); otherwise the control replaces it. */
  desktopPriceWithControls?: boolean;
  /** "chevron" for rows that open a variant picker instead of adding. */
  addTileIcon?: "plus" | "chevron";
  className?: string;
}) {
  const addTile = showAddTile && controls == null && !selected ? (
    <span className="grid size-11 place-items-center rounded-[12px] bg-ios-accent/12 text-ios-accent lg:hidden" aria-hidden="true">
      {addTileIcon === "chevron"
        ? <ChevronRight className="size-[22px]" strokeWidth={2.6} />
        : <Plus className="size-[22px]" strokeWidth={2.6} />}
    </span>
  ) : null;
  return (
    <div
      className={cn(
        "grid min-h-16 grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2 text-left sm:flex sm:gap-3",
        "max-lg:flex max-lg:min-h-[104px] max-lg:gap-3 max-lg:px-3.5 max-lg:py-2",
        selected ? "bg-primary-50 dark:bg-primary-950/40 max-lg:bg-ios-accent/[0.08] max-lg:dark:bg-ios-accent/[0.16]" : "cursor-pointer hover:bg-surface-2 max-lg:hover:bg-transparent max-lg:active:bg-black/[0.04] max-lg:dark:active:bg-white/[0.06]",
        className,
      )}
      {...props}
    >
      <div className="shrink-0 max-lg:[&>*]:!size-10 max-lg:[&>*]:!rounded-[10px]">{leading}</div>
      <div className="min-w-0 flex-1 max-lg:space-y-[3px]">{summary}</div>
      {(controls != null || price != null || addTile) && (
        <div className={cn(
          "col-span-2 flex min-w-0 items-center justify-end gap-2 sm:col-auto sm:ml-auto sm:w-auto sm:shrink-0",
          "max-lg:w-[124px] max-lg:shrink-0 max-lg:flex-col max-lg:items-end max-lg:justify-center",
        )}>
          {/* Desktop order: control, then price. Phones: price on top. */}
          {price != null && (
            <div className={cn("max-lg:order-first lg:order-last", controls != null && !desktopPriceWithControls && "lg:hidden")}>{price}</div>
          )}
          {controls}
          {addTile}
        </div>
      )}
    </div>
  );
}

/** Product name in a search row: 15pt bold, two lines on phones (POSProductSearchRow). */
export const productSearchNameClass = "text-sm font-semibold max-lg:line-clamp-2 max-lg:text-[15px] max-lg:font-bold max-lg:leading-5";
/** Secondary line (SKU / unit) in a search row. */
export const productSearchMetaClass = "text-xs text-slate-400 max-lg:text-[13px] max-lg:leading-[18px] max-lg:text-ios-label-secondary";
/** Price label in a search row: accent, heavy and tabular on phones. */
export const productSearchPriceClass = "shrink-0 text-sm font-semibold text-primary-600 tabular-nums max-lg:text-[15px] max-lg:font-extrabold max-lg:text-ios-accent";

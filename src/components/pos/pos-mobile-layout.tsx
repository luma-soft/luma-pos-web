import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type UnitLike = {
  unitName: string;
};

export function buildPosUnitOptions(baseUnit: string, units: UnitLike[]) {
  const names = [baseUnit, ...units.map((unit) => unit.unitName)]
    .map((unitName) => unitName.trim())
    .filter(Boolean);

  return [...new Set(names)].map((unitName) => ({
    value: unitName,
    label: unitName,
  }));
}

export function posUnitSuffix(unitName: string) {
  const unit = unitName.trim();
  return unit ? `/${unit}` : "";
}

export function PosQuantitySlot({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("group relative w-[8.25rem] shrink-0", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PosSearchResultLayout({
  selected = false,
  leading,
  summary,
  controls,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  selected?: boolean;
  leading: ReactNode;
  summary: ReactNode;
  controls: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2 text-left sm:flex sm:gap-3",
        selected ? "bg-primary-50 dark:bg-primary-950/40" : "cursor-pointer hover:bg-surface-2",
        className,
      )}
      {...props}
    >
      <div className="shrink-0">{leading}</div>
      <div className="min-w-0 flex-1">{summary}</div>
      <div className="col-span-2 flex min-w-0 items-center justify-end gap-2 sm:col-auto sm:ml-auto sm:w-auto sm:shrink-0">
        {controls}
      </div>
    </div>
  );
}

export function PosSearchResultsSurface({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "absolute left-0 right-14 top-full z-40 mt-1 max-h-[min(64dvh,520px)] overflow-auto rounded-xl border border-border bg-surface shadow-e2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PosCartScrollSurface({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full shrink-0 flex-col overflow-y-auto overscroll-contain border-t border-border bg-surface transition-colors lg:h-auto lg:w-[560px] lg:overflow-hidden lg:border-l lg:border-t-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type UnitLike = {
  unitName: string;
  directSale?: boolean;
};

export function buildPosUnitOptions(
  baseUnit: string,
  units: UnitLike[],
  options: {
    baseUnitDirectSale?: boolean;
    selectedUnitName?: string;
    unavailableLabel?: string;
  } = {},
) {
  const names = new Map<string, { directSale: boolean }>();
  const baseName = baseUnit.trim();
  if (baseName && (options.baseUnitDirectSale !== false || options.selectedUnitName === baseName)) {
    names.set(baseName, { directSale: options.baseUnitDirectSale !== false });
  }
  for (const unit of units) {
    const unitName = unit.unitName.trim();
    if (!unitName || (unit.directSale === false && options.selectedUnitName !== unitName)) continue;
    names.set(unitName, { directSale: unit.directSale !== false });
  }
  if (options.selectedUnitName && !names.has(options.selectedUnitName)) {
    names.set(options.selectedUnitName, { directSale: false });
  }

  return [...names.entries()].map(([unitName, state]) => ({
    value: unitName,
    label: state.directSale ? unitName : `${unitName} · ${options.unavailableLabel ?? "Ngừng bán"}`,
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

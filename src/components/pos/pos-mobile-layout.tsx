import type { HTMLAttributes } from "react";
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

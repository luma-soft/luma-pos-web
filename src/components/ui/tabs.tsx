"use client";

import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex snap-x snap-mandatory items-center gap-1 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:h-0", className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex h-11 min-w-11 shrink-0 snap-start items-center gap-2 rounded-[10px] px-3.5 text-xs font-semibold transition-colors lg:h-9 lg:min-w-0",
              active
                ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
                : "text-slate-500 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200",
            )}
          >
            <span>{item.label}</span>
            {item.count != null && item.count > 0 && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-surface-2 px-1 font-mono text-[9px] font-bold text-current">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

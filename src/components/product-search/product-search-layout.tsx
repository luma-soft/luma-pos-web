import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ProductSearchResultLayout({
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
  controls?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid min-h-11 grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2 text-left sm:flex sm:gap-3",
        selected ? "bg-primary-50 dark:bg-primary-950/40" : "cursor-pointer hover:bg-surface-2",
        className,
      )}
      {...props}
    >
      <div className="shrink-0">{leading}</div>
      <div className="min-w-0 flex-1">{summary}</div>
      {controls != null && (
        <div className="col-span-2 flex min-w-0 items-center justify-end gap-2 sm:col-auto sm:ml-auto sm:w-auto sm:shrink-0">
          {controls}
        </div>
      )}
    </div>
  );
}

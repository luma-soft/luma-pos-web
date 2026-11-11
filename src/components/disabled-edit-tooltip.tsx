import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Keep a blocked edit action visible, with an explanation on hover/focus. */
export function DisabledEditTooltip({
  reason,
  className,
  children,
}: {
  reason: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="group relative inline-flex cursor-not-allowed"
      tabIndex={0}
      title={reason}
      aria-label={reason}
    >
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={cn(className, "pointer-events-none cursor-not-allowed opacity-50")}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-[100] mb-2 w-max max-w-[min(20rem,90vw)] -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-center text-xs font-medium leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 dark:bg-slate-700"
      >
        {reason}
      </span>
    </span>
  );
}

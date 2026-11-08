"use client";

import type { ReactNode } from "react";

/**
 * Native-style invoice summary for mobile lists. Rendered only inside
 * DataTableShell.renderMobileRow; desktop columns and row behavior stay intact.
 */
export function MobileDocumentRow({
  customerName,
  customer,
  dayHeading,
  amount,
  amountTone = "default",
  code,
  createdAt,
  details,
  onOpen,
}: {
  customerName: string;
  customer: ReactNode;
  dayHeading?: string;
  amount: string;
  amountTone?: "default" | "danger";
  code: string;
  createdAt: string;
  details?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <div>
      {dayHeading && (
        <div className="border-b border-border-soft bg-surface-2/60 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300" role="heading" aria-level={3}>
          {dayHeading}
        </div>
      )}
    <div className="relative min-h-[104px] min-w-0 px-3 py-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${customerName} · ${code}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-primary-500"
      />
      <div className="pointer-events-none relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-[15px] font-semibold">
          {customer}
        </div>
        <span className={`min-w-0 max-w-[48%] shrink-0 text-right text-[15px] font-semibold tabular-nums [overflow-wrap:anywhere] ${amountTone === "danger" ? "text-er" : ""}`}>
          {amount}
        </span>
      </div>
      {details != null && (
        <div className="pointer-events-none relative mt-1.5 min-w-0 text-xs text-slate-500 dark:text-slate-400">
          {details}
        </div>
      )}
      <div className="pointer-events-none relative mt-2 truncate text-[11px] text-slate-500 dark:text-slate-400">
        {createdAt} · {code}
      </div>
    </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { useLongPress } from "@/components/use-long-press";
import { cn } from "@/lib/utils";
import type { MobileDocumentDayGroup } from "./mobile-document-day";

/** LumaGroupedListHeader: day title with the day's count and total. */
export function MobileDocumentDayHeader({ title, summary }: { title: string; summary?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 bg-surface px-4 pb-1 pt-4" role="heading" aria-level={3}>
      <span className="min-w-0 truncate text-[15px] font-semibold text-ios-label-secondary">{title}</span>
      {summary && <span className="shrink-0 text-[13px] text-ios-label-tertiary tabular-nums">{summary}</span>}
    </div>
  );
}

/**
 * Native-style document row for mobile lists (NativeInvoiceHistoryRow): headline
 * customer and amount, status line, item summary and a tertiary timestamp · code.
 * Rendered only inside DataTableShell.renderMobileRow; desktop columns stay intact.
 */
export function MobileDocumentRow({
  customerName,
  customer,
  dayHeading,
  dayGroup,
  amount,
  amountTone = "default",
  status,
  code,
  createdAt,
  details,
  leading,
  selected = false,
  onOpen,
  onLongPress,
}: {
  customerName: string;
  customer: ReactNode;
  /** Legacy heading without a summary; dayGroup takes precedence. */
  dayHeading?: string;
  dayGroup?: MobileDocumentDayGroup;
  amount: string;
  amountTone?: "default" | "danger";
  status?: ReactNode;
  code: string;
  createdAt: string;
  details?: ReactNode;
  /** Selection indicator shown while the list is in selection mode. */
  leading?: ReactNode;
  selected?: boolean;
  onOpen: () => void;
  onLongPress?: () => void;
}) {
  const longPress = useLongPress(onLongPress);

  return (
    <div>
      {dayGroup ? <MobileDocumentDayHeader title={dayGroup.title} summary={dayGroup.summary} />
        : dayHeading ? <MobileDocumentDayHeader title={dayHeading} /> : null}
      <div className={cn("flex min-w-0 items-center gap-3 pl-4", selected && "bg-primary-600/[0.06]")}>
        {leading}
        <div className="relative min-w-0 flex-1 border-b border-border py-3 pr-4">
          <button
            type="button"
            onClick={() => {
              if (!longPress.consumeClick()) onOpen();
            }}
            {...longPress.handlers}
            aria-label={`${customerName} · ${code}`}
            className="absolute inset-0 -left-4 [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ios-accent active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          />
          <div className="pointer-events-none relative flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-[22px]">
              {customer}
            </div>
            <span className={cn(
              "min-w-0 max-w-[52%] shrink-0 text-right text-[17px] font-semibold leading-[22px] tabular-nums [overflow-wrap:anywhere]",
              amountTone === "danger" && "text-ios-red",
            )}>
              {amount}
            </span>
          </div>
          {status != null && (
            <div className="pointer-events-none relative mt-1.5 text-[15px] leading-5 text-ios-label-secondary">{status}</div>
          )}
          {details != null && (
            <div className="pointer-events-none relative mt-1.5 line-clamp-2 min-w-0 text-[12px] leading-4 text-ios-label-secondary">
              {details}
            </div>
          )}
          <div className="pointer-events-none relative mt-1.5 truncate text-[11px] leading-[13px] text-ios-label-tertiary">
            {createdAt} · {code}
          </div>
        </div>
      </div>
    </div>
  );
}

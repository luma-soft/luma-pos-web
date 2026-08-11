"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

export function PartnerDebtDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center" onMouseDown={onClose}>
      <section className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-card bg-surface p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" aria-label="Đóng" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-surface-2 lg:min-h-9 lg:min-w-9">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function DebtBalanceSummary({ value, tone = "danger" }: { value: number; tone?: "danger" | "warning" | "success" }) {
  return (
    <div className={cn(
      "flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-sm",
      tone === "danger" && "border-red-100 bg-red-50/70 dark:border-red-950 dark:bg-red-950/20",
      tone === "warning" && "border-amber-100 bg-amber-50/70 dark:border-amber-950 dark:bg-amber-950/20",
      tone === "success" && "border-emerald-100 bg-emerald-50/70 dark:border-emerald-950 dark:bg-emerald-950/20",
    )}>
      <span className="font-medium text-slate-600 dark:text-slate-300">Công nợ hiện tại</span>
      <strong className={cn(
        "tabular-nums",
        tone === "danger" && "text-er",
        tone === "warning" && "text-warn",
        tone === "success" && "text-ok",
      )}>{formatCurrency(value)}</strong>
    </div>
  );
}

export function DebtDialogFooter({
  onCancel,
  onConfirm,
  confirmLabel,
  disabled,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 border-t border-border-soft pt-4">
      <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-primary-700 hover:bg-surface-2 min-w-11 lg:min-w-0">
        Hủy
      </button>
      <button type="button" onClick={onConfirm} disabled={disabled} className="min-h-11 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-50 min-w-11 lg:min-w-0">
        {confirmLabel}
      </button>
    </div>
  );
}

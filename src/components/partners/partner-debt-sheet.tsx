"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Phone presentation of the debt payment / adjustment forms
 * (NativeCustomerCollectionSheet, NativeCustomerDebtAdjustmentSheet,
 * NativeSupplierPayableSheet): a bottom sheet with a grabber, "Hủy" and confirm
 * capsules around a centred title, and titled cards on the grouped background.
 */
export function DebtSheet({
  title,
  confirmLabel,
  confirmDisabled,
  pending,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  confirmDisabled: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  const capsule = "inline-flex h-12 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-surface/90 px-4 text-[17px] shadow-[0_2px_10px_rgb(0_0_0/0.08)] dark:border-white/10";
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end bg-black/35" onMouseDown={() => { if (!pending) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] w-full flex-col overflow-hidden rounded-t-[38px] bg-canvas"
      >
        <div className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full bg-black/20 dark:bg-white/25" aria-hidden="true" />
        <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-4 pb-2 pt-2">
          <button type="button" onClick={onClose} disabled={pending} data-button-radius="pill" className={cn(capsule, "text-ios-accent disabled:opacity-50")}>Hủy</button>
          {/* iOS shrinks long titles (minimumScaleFactor 0.75) instead of truncating. */}
          <h2 className={cn("truncate text-center font-semibold", title.length > 20 ? "text-[13.5px]" : "text-[17px]")}>{title}</h2>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled || pending}
            data-button-radius="pill"
            className={cn(capsule, "font-semibold text-ios-accent disabled:font-normal disabled:text-ios-label-tertiary")}
          >
            {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : confirmLabel}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-ios-section overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function DebtSheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-1 pb-2 text-[17px] font-semibold text-ios-label-secondary">{title}</h3>
      <div className="space-y-3 rounded-[16px] bg-surface p-3">{children}</div>
    </section>
  );
}

/** LumaDebtBalanceSummary: tinted capsule with the current balance. */
export function DebtSheetBalance({ value, tone = "danger" }: { value: number; tone?: "danger" | "warning" }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-[12px] px-4 py-3.5", tone === "danger" ? "bg-ios-red/10" : "bg-ios-orange/10")}>
      <span className="text-[17px] text-ios-label-secondary">Công nợ hiện tại</span>
      <strong className={cn("text-[20px] font-bold tabular-nums", tone === "danger" ? "text-ios-red" : "text-ios-orange")}>{formatCurrency(value)}</strong>
    </div>
  );
}

/** LumaDateTimePickerField: label with time and date capsules ("YYYY-MM-DDTHH:mm"). */
export function DebtSheetTime({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [date = "", time = ""] = value.split("T");
  const pill = "h-11 appearance-none rounded-full bg-black/[0.06] px-4 text-[17px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ios-accent dark:bg-white/10";
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 whitespace-nowrap text-[17px]">Thời gian</span>
      <input type="time" aria-label="Giờ" value={time} onChange={(event) => onChange(`${date}T${event.target.value}`)} required className={cn(pill, "w-[108px] shrink-0 px-3")} />
      <input type="date" aria-label="Ngày" value={date} onChange={(event) => onChange(`${event.target.value}T${time}`)} required className={cn(pill, "min-w-0 max-w-[180px] px-3")} />
    </div>
  );
}

/** LumaLabeledAmountInputField: caption, bordered amount field with "đ", helper. */
export function DebtSheetAmount({
  label,
  value,
  onChange,
  min = 0,
  max,
  helper,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="block pb-1.5 text-[15px] text-ios-label-secondary">{label}</span>
      <span className="flex h-12 items-center gap-2 rounded-[12px] border border-ios-stroke/40 bg-surface px-4 focus-within:border-ios-accent">
        <MoneyInput value={value} min={min} max={max} onChange={onChange} placeholder="0" className="min-w-0 flex-1 bg-transparent text-[17px] tabular-nums outline-none placeholder:text-ios-label-tertiary" />
        <span className="text-[17px] text-ios-label-secondary" aria-hidden="true">đ</span>
      </span>
      {helper && <span className="block pt-1.5 text-[13px] text-ios-label-secondary">{helper}</span>}
    </label>
  );
}

export function DebtSheetMethod({ value, onChange }: { value: "cash" | "bank_transfer"; onChange: (value: "cash" | "bank_transfer") => void }) {
  return (
    <div className="grid grid-cols-2 rounded-full bg-ios-accent/10 p-1" role="radiogroup" aria-label="Phương thức thanh toán">
      {(["cash", "bank_transfer"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          data-button-radius="pill"
          className={cn("min-h-10 rounded-full text-[17px]", value === key ? "bg-ios-accent font-semibold text-white" : "font-medium text-ios-label")}
        >
          {key === "cash" ? "Tiền mặt" : "Chuyển khoản"}
        </button>
      ))}
    </div>
  );
}

/** One open invoice: code and remaining on the left, "Thanh toán" amount box on the right. */
export function DebtSheetAllocationRow({
  code,
  remaining,
  value,
  onChange,
  disabled,
}: {
  code: string;
  remaining: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{code}</span>
        <span className="mt-1 block text-[12px] text-ios-label-secondary">Còn nợ {formatCurrency(remaining)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[12px] text-ios-label-secondary">Thanh toán</span>
        <span className="flex h-11 w-[128px] items-center gap-1.5 rounded-[12px] border border-ios-stroke/40 bg-surface px-3 focus-within:border-ios-accent">
          <MoneyInput value={value} min={0} max={remaining} disabled={disabled} onChange={(next) => onChange(next ?? 0)} aria-label={`Thanh toán hóa đơn ${code}`} className="min-w-0 flex-1 bg-transparent text-[15px] tabular-nums outline-none disabled:opacity-50" />
          <span className="text-[15px] font-medium text-ios-label-secondary" aria-hidden="true">đ</span>
        </span>
      </span>
    </div>
  );
}

export function DebtSheetRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[17px]">
      <span className="text-ios-label-secondary">{label}</span>
      <span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

export function DebtSheetReason({ placeholder, value, onChange, showCount = false }: { placeholder: string; value: string; onChange: (value: string) => void; showCount?: boolean }) {
  return (
    <label className="block">
      <textarea
        value={value}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={3}
        className="block min-h-24 w-full resize-none rounded-[12px] border border-ios-stroke/40 bg-surface px-4 py-3 text-[17px] outline-none placeholder:text-ios-label-tertiary focus:border-ios-accent"
      />
      {showCount && <span className="block pt-1.5 text-right text-[13px] text-ios-label-secondary">{value.length}/200</span>}
    </label>
  );
}

export function DebtSheetNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return <p className={cn("text-[13px] leading-[18px]", tone === "error" ? "text-ios-red" : "text-ios-label-secondary")}>{children}</p>;
}

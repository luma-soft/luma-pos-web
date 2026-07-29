"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { Text } from "@/components/ui/text";
import type { PaperSize } from "@/lib/print/template-shared";
import { cn, formatNumber } from "@/lib/utils";

export function PosSummaryAdjustRow({
  label,
  hint,
  hintVisible = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  hintVisible?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,184px)] items-start gap-2">
      <Text as="span" variant="muted" className="pt-2.5" text={label} />
      <div className="grid justify-items-end gap-1">
        {children}
        <Text
          as="div"
          variant="muted"
          size="xs"
          aria-hidden={!hintVisible}
          className={cn(
            "h-4 tabular-nums transition-opacity duration-150",
            hintVisible ? "opacity-100" : "opacity-0",
          )}
        >
          {hint ?? "\u00a0"}
        </Text>
      </div>
    </div>
  );
}

export function PosStockQuantityTooltip({ stock, booked, unit }: { stock: number; booked: number; unit: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-[80] mt-2 min-w-34 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-slate-800 opacity-0 shadow-e2 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:text-slate-100">
      <div>{`Tồn: ${formatNumber(stock)} ${unit}`}</div>
      <div>{`Đặt: ${formatNumber(booked)} ${unit}`}</div>
    </div>
  );
}

export function PosPrintSizePicker({
  value,
  options,
  onChange,
}: {
  value: PaperSize;
  options: { value: PaperSize; label: string }[];
  onChange: (value: PaperSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative w-28">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 text-left text-xs font-semibold transition hover:bg-surface-2 focus:border-primary-600 focus:outline-none lg:h-8"
      >
        <span className="whitespace-normal break-words">{selected?.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="listbox" className="absolute bottom-full right-0 z-50 mb-1 w-32 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-e2">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-surface-2 lg:min-h-0",
                  active && "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200",
                )}
              >
                <span>{option.label}</span>
                {active && <CheckCircle2 className="h-4 w-4 text-primary-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PosAmountModeInput({
  value,
  mode,
  onValueChange,
  onModeChange,
  className,
}: {
  value: number;
  mode: "vnd" | "pct";
  onValueChange: (value: number) => void;
  onModeChange?: (mode: "vnd" | "pct") => void;
  className?: string;
}) {
  return (
    <div className={cn(
      "grid h-11 w-full max-w-[184px] grid-cols-[1fr_56px] overflow-hidden rounded-lg border border-border bg-surface transition-[border-color] duration-150 focus-within:border-primary-600",
      className,
    )}>
      {mode === "pct" ? (
        <NumberInput
          min={0}
          max={100}
          value={value}
          onChange={(nextValue) => onValueChange(nextValue ?? 0)}
          placeholder="0"
          thousandSeparator={false}
          className="h-full min-w-0 rounded-none border-0 bg-transparent px-3 text-right text-sm tabular-nums outline-none focus:border-transparent focus-visible:border-transparent focus:ring-0"
        />
      ) : (
        <MoneyInput
          value={value || ""}
          onChange={(nextValue) => onValueChange(nextValue ?? 0)}
          placeholder="0"
          className="no-spinner h-full min-w-0 border-0 bg-transparent px-3 text-right text-sm tabular-nums outline-none focus:border-transparent focus-visible:border-transparent"
        />
      )}
      {onModeChange ? (
        <Button
          type="button"
          onClick={() => onModeChange(mode === "vnd" ? "pct" : "vnd")}
          variant="ghost"
          size="default"
          className="h-full rounded-none border-l border-border text-sm font-semibold text-slate-600 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-950/30"
        >
          {mode === "vnd" ? "đ" : "%"}
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </Button>
      ) : (
        <Text as="span" variant="muted" weight="semibold" className="grid place-items-center border-l border-border text-sm">
          {mode === "vnd" ? "đ" : "%"}
        </Text>
      )}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { Minus, Plus, RotateCcw, Star } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { TouchTargetToggle } from "@/components/mobile-ui";
import { cn } from "@/lib/utils";

/**
 * Shared pieces of the print and label template editors. Desktop keeps the
 * bordered panels; phones (below `lg`) follow the iOS template designer:
 * inset-grouped cards, 15pt field labels, 48pt fields and switch rows.
 */

export const TEMPLATE_INPUT =
  "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm lg:min-h-10 max-lg:min-h-12 max-lg:rounded-[12px] max-lg:border-ios-stroke/40 max-lg:px-4 max-lg:text-[17px] max-lg:focus:border-ios-accent max-lg:focus:outline-none";

export function TemplatePanel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface p-3 md:p-5 max-lg:rounded-[22px] max-lg:border-0 max-lg:p-ios-inset", className)}>
      {title && <h2 className="mb-3 text-sm font-bold max-lg:text-[17px] max-lg:font-semibold max-lg:leading-[22px]">{title}</h2>}
      {children}
    </div>
  );
}

export function TemplateField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-semibold text-slate-500 max-lg:mb-1.5 max-lg:text-[15px] max-lg:font-normal max-lg:text-ios-label-secondary">{label}</span>
      {children}
    </label>
  );
}

/** Checkbox on desktop; an iOS switch row on phones. */
export function TemplateOptionRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <>
      <label className="flex min-h-11 items-center gap-2 text-sm max-lg:hidden lg:min-h-0">
        <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border last:border-b-0 lg:hidden">
        <span className="min-w-0 flex-1 text-[17px] leading-[22px]">{label}</span>
        <TouchTargetToggle checked={checked} onChange={onChange} aria-label={label} />
      </div>
    </>
  );
}

/** Option list: a two-column grid on desktop, separator rows on phones. */
export function TemplateOptionList({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 max-lg:block">{children}</div>;
}

/** Horizontally scrolling capsule picker, like LumaSegmentedControl on iOS. */
export function TemplateSegments<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="-mx-ios-inset flex gap-1.5 overflow-x-auto px-ios-inset lg:hidden [scrollbar-width:none]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          data-button-radius="pill"
          className={cn(
            "min-h-[38px] shrink-0 rounded-full px-3.5 text-[15px] font-semibold transition",
            value === option.value ? "bg-ios-accent text-white" : "bg-surface text-ios-label",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Phone template list: one row per template with its paper/size summary. */
export function TemplateListPhone<T extends { id: string; name: string; isDefault: boolean; isActive: boolean }>({
  title,
  templates,
  selectedId,
  onSelect,
  subtitle,
  emptyLabel,
}: {
  title: string;
  templates: T[];
  selectedId: string;
  onSelect: (id: string) => void;
  subtitle: (template: T) => string;
  emptyLabel: string;
}) {
  return (
    <section className="lg:hidden">
      <h2 className="mb-2 px-1 text-[13px] font-semibold text-ios-label-secondary">{title}</h2>
      <div className="overflow-hidden rounded-[22px] bg-surface">
        {templates.length === 0 ? (
          <p className="px-ios-inset py-4 text-center text-[15px] text-ios-label-secondary">{emptyLabel}</p>
        ) : templates.map((template) => {
          const active = template.id === selectedId;
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(template.id)}
              className={cn(
                "flex min-h-[60px] w-full items-center gap-3 border-b border-border px-ios-inset py-2.5 text-left last:border-b-0",
                active && "bg-ios-accent/10",
                !template.isActive && "opacity-60",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[17px] font-semibold leading-[22px]", active && "text-ios-accent")}>{template.name}</span>
                <span className="mt-0.5 block truncate text-[13px] text-ios-label-secondary">{subtitle(template)}</span>
              </span>
              {template.isDefault && <Star className="size-5 shrink-0 fill-current text-ios-accent" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Font size row: name, value and an iOS-style −/+ stepper with reset. */
export function TemplateStepperRow({
  label,
  value,
  unit,
  onDecrease,
  onIncrease,
  onReset,
  decreaseLabel,
  increaseLabel,
  resetLabel,
}: {
  label: string;
  value: number;
  unit: string;
  onDecrease: () => void;
  onIncrease: () => void;
  onReset: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  resetLabel: string;
}) {
  return (
    <>
      <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border-soft px-3 py-2 max-lg:hidden">
        <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
        <button type="button" aria-label={decreaseLabel} onClick={onDecrease} className="min-h-9 min-w-9 rounded border border-border">−</button>
        <span className="w-12 text-center text-sm font-bold">{value} {unit}</span>
        <button type="button" aria-label={increaseLabel} onClick={onIncrease} className="min-h-9 min-w-9 rounded border border-border">+</button>
        <button type="button" aria-label={resetLabel} onClick={onReset} className="min-h-9 min-w-9 rounded border border-border">↺</button>
      </div>
      <div className="flex min-h-[52px] items-center gap-2 border-b border-border last:border-b-0 lg:hidden">
        <span className="min-w-0 flex-1 text-[15px] font-medium leading-5">{label}</span>
        <span className="min-w-12 text-right text-[13px] tabular-nums text-ios-label-secondary">{value} {unit}</span>
        <span className="flex h-8 shrink-0 items-center rounded-[9px] bg-black/[0.06] dark:bg-white/10">
          <button type="button" aria-label={decreaseLabel} onClick={onDecrease} className="grid h-8 w-11 place-items-center">
            <Minus className="size-4" strokeWidth={2.4} aria-hidden="true" />
          </button>
          <span className="h-4 w-px bg-ios-stroke/50" aria-hidden="true" />
          <button type="button" aria-label={increaseLabel} onClick={onIncrease} className="grid h-8 w-11 place-items-center">
            <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </span>
        <button type="button" aria-label={resetLabel} onClick={onReset} className="grid size-9 shrink-0 place-items-center text-ios-accent">
          <RotateCcw className="size-4" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

/** Phone-only classes for choice buttons (paper size, QR source…); desktop classes stay with the caller. */
export function templateChoiceClass(active: boolean) {
  return active
    ? "max-lg:!rounded-[12px] max-lg:text-[15px] max-lg:border-ios-accent max-lg:bg-ios-accent max-lg:text-white dark:max-lg:bg-ios-accent dark:max-lg:text-white"
    : "max-lg:!rounded-[12px] max-lg:text-[15px] max-lg:border-ios-stroke/40 max-lg:bg-transparent max-lg:text-ios-label dark:max-lg:text-ios-label";
}

/** Inline status line under the editor on phones (desktop uses its own toast). */
export function TemplateStatus({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role="status" aria-live="polite" className={cn("px-1 text-[15px] font-medium lg:hidden", msg.ok ? "text-ios-green" : "text-ios-red")}>
      {msg.text}
    </p>
  );
}

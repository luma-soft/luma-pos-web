"use client";
import { legacyTextByFlag } from "@/lib/i18n/catalog-text";

import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { usePhoneLayout } from "@/components/use-phone-layout";

type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type: "date" | "datetime-local";
  /** Leaves room for a caller-rendered action (e.g. clear) beside the calendar icon. */
  wideTrailingInset?: boolean;
};

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isDateInputValueValid(value: string, type: DateInputProps["type"], min?: string | number, max?: string | number) {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match || (type === "datetime-local") !== Boolean(match[4])) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (isoDay(date) !== value.slice(0, 10) || Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59 || Number(match[6] ?? 0) > 59) return false;
  const normalized = type === "datetime-local" && value.length === 16 ? `${value}:00` : value;
  const lower = type === "datetime-local" && String(min).length === 16 ? `${min}:00` : String(min);
  const upper = type === "datetime-local" && String(max).length === 16 ? `${max}:00` : String(max);
  return (!min || normalized >= lower) && (!max || normalized <= upper);
}

/** Shared calendar and local date/time entry; never opens an OS date picker. */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ type, wideTrailingInset = false, value, defaultValue, name, className, min, max, disabled, readOnly, required, onInvalid, onChange, onKeyDown, onClick, placeholder, ...props }, forwardedRef) => {
    const locale = useLocale();
    const vi = locale.startsWith("vi");
    // Phones open the calendar as a full-screen sheet (iOS parity).
    const phone = usePhoneLayout();
    const initialValue = String(value ?? defaultValue ?? "");
    const [internalValue, setInternalValue] = React.useState(initialValue);
    const committedValue = value === undefined ? internalValue : String(value);
    const [lastValue, setLastValue] = React.useState(committedValue);
    const [draft, setDraft] = React.useState(committedValue);
    if (lastValue !== committedValue) {
      setLastValue(committedValue);
      setDraft(committedValue);
    }
    const [open, setOpen] = React.useState(false);
    const [month, setMonth] = React.useState(() => new Date());
    const [position, setPosition] = React.useState<React.CSSProperties>({});
    const rootRef = React.useRef<HTMLDivElement>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const validationRef = React.useRef<HTMLInputElement>(null);
    const popupRef = React.useRef<HTMLDivElement>(null);
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const repositionRef = React.useRef<() => void>(() => {});
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const popupId = React.useId();
    const dateTime = type === "datetime-local";
    const chooseLabel = legacyTextByFlag(vi, "ad7236a9559f");
    React.useImperativeHandle(forwardedRef, () => inputRef.current!, []);

    React.useEffect(() => {
      validationRef.current?.setCustomValidity(readOnly || isDateInputValueValid(committedValue, type, min, max) ? "" : legacyTextByFlag(vi, "84eec5799fdb"));
    }, [committedValue, type, min, max, readOnly, vi]);

    React.useEffect(() => {
      if (!open) return;
      const outside = (event: Event) => {
        const target = event.target as Node;
        if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
      };
      const reposition = () => {
        if (phone) {
          setPosition({ position: "fixed", inset: 0 });
          return;
        }
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        const margin = 8;
        const gap = 4;
        const width = Math.min(320, window.innerWidth - margin * 2);
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
        // Natural height = full body + the popup's own chrome (padding, border, footer).
        const popup = popupRef.current;
        const body = bodyRef.current;
        const natural = popup && body ? body.scrollHeight + popup.offsetHeight - body.clientHeight : 520;
        const below = window.innerHeight - rect.bottom - gap - margin;
        const above = rect.top - gap - margin;
        const viewport = window.innerHeight - margin * 2;
        if (natural <= below) {
          setPosition({ position: "fixed", width, left, top: rect.bottom + gap, maxHeight: below });
        } else if (natural <= above) {
          setPosition({ position: "fixed", width, left, top: rect.top - gap - natural, maxHeight: above });
        } else {
          // Neither side fits a short window: slide up over the field so the
          // whole calendar, time and Clear/Apply stay visible. Only a window
          // shorter than the calendar scrolls its body (the footer stays put).
          const height = Math.min(natural, viewport);
          setPosition({ position: "fixed", width, left, top: Math.max(margin, Math.min(rect.bottom + gap, window.innerHeight - margin - height)), maxHeight: height });
        }
      };
      repositionRef.current = reposition;
      reposition();
      const focus = window.requestAnimationFrame(() => (popupRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? popupRef.current?.querySelector<HTMLButtonElement>('[data-day]:not(:disabled)'))?.focus({ preventScroll: true }));
      document.addEventListener("pointerdown", outside);
      document.addEventListener("focusin", outside);
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);
      return () => {
        window.cancelAnimationFrame(focus);
        document.removeEventListener("pointerdown", outside);
        document.removeEventListener("focusin", outside);
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
      };
    }, [open, phone]);

    React.useEffect(() => {
      const form = inputRef.current?.form;
      if (!form || value !== undefined) return;
      const reset = () => { setInternalValue(String(defaultValue ?? "")); setDraft(String(defaultValue ?? "")); setOpen(false); };
      form.addEventListener("reset", reset);
      return () => form.removeEventListener("reset", reset);
    }, [value, defaultValue]);

    // A month with five or six week rows changes the popup's height.
    React.useLayoutEffect(() => {
      if (open) repositionRef.current();
    }, [open, month, dateTime]);

    function change(next: string) {
      setDraft(next);
      if (!isDateInputValueValid(next, type, min, max)) return;
      if (value === undefined) setInternalValue(next);
      const target = { value: next, name, type };
      onChange?.({ target, currentTarget: target } as React.ChangeEvent<HTMLInputElement>);
    }

    function close() {
      setOpen(false);
      triggerRef.current?.focus();
    }

    function openCalendar() {
      const chosen = /^\d{4}-\d{2}-\d{2}/.test(committedValue) ? new Date(`${committedValue.slice(0, 10)}T12:00:00`) : new Date();
      setMonth(new Date(chosen.getFullYear(), chosen.getMonth(), 1));
      setDraft(committedValue);
      setOpen(!open);
    }

    function pickDay(day: string) {
      const time = draft.split("T")[1] || "00:00";
      let next = dateTime ? `${day}T${time}` : day;
      if (min && next < String(min) && String(min).startsWith(day)) next = String(min);
      if (max && next > String(max) && String(max).startsWith(day)) next = String(max);
      if (dateTime) setDraft(next);
      else { change(next); close(); }
    }

    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const time = (draft.split("T")[1] || "00:00").slice(0, 5);
    const validDraft = (!required || Boolean(draft)) && isDateInputValueValid(draft, type, min, max);
    const navButtonStyle = "grid size-11 shrink-0 place-items-center rounded-full text-primary-600 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-600";
    const buttonStyle = phone
      ? "grid aspect-square min-h-11 w-full place-items-center rounded-full text-[17px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-30"
      : "grid min-h-8 min-w-8 place-items-center rounded-lg text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-30";

    return (
      <div ref={rootRef} className="relative min-w-0">
        <input
          {...props}
          ref={inputRef}
          type="text"
          disabled={disabled}
          readOnly
          value={committedValue}
          placeholder={placeholder ?? (dateTime ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD")}
          autoComplete="off"
          className={cn("h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3 pr-12 text-base outline-none focus:border-primary-600 disabled:opacity-50 lg:text-sm", className, wideTrailingInset ? "pr-20" : "pr-12")}
          onClick={(event) => { onClick?.(event); if (!event.defaultPrevented && !readOnly) openCalendar(); }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (!event.defaultPrevented && ["ArrowDown", "Enter", " "].includes(event.key) && !readOnly) { event.preventDefault(); openCalendar(); }
          }}
        />
        <input ref={validationRef} type="text" name={name} value={committedValue} onChange={() => {}} required={required && !readOnly} disabled={disabled} form={props.form} tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute size-px opacity-0" onInvalid={(event) => { onInvalid?.(event); event.preventDefault(); openCalendar(); }} />
        <button ref={triggerRef} type="button" aria-label={chooseLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined} disabled={disabled || readOnly} onClick={openCalendar} className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-500 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-50">
          <CalendarDays className="size-4" />
        </button>
        {open && !disabled && !readOnly && createPortal(
          <div ref={popupRef} id={popupId} role="dialog" aria-label={chooseLabel} style={position} className={cn(
            "flex flex-col overflow-hidden text-slate-900 dark:text-slate-100",
            phone
              ? "z-[1000] bg-canvas px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
              : "z-[1000] rounded-xl border border-border bg-surface p-3 shadow-e2",
          )} onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          }}>
            {phone && (
              <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center">
                <button type="button" onClick={close} className="justify-self-start rounded-full bg-surface px-4 py-2.5 text-[17px] text-primary-600 shadow-sm ring-1 ring-black/5 dark:ring-white/10">{vi ? "Hủy" : "Cancel"}</button>
                <span className="text-[17px] font-semibold">{dateTime ? legacyTextByFlag(vi, "8698d9e5abb9") : chooseLabel}</span>
                <span />
              </div>
            )}
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <label className="mb-2 block text-xs font-medium">
              <span className={cn(phone && "sr-only")}>{dateTime ? (legacyTextByFlag(vi, "8698d9e5abb9")) : (legacyTextByFlag(vi, "69790dda07ce"))}</span>
              <input type="text" value={draft} aria-invalid={!validDraft} placeholder={dateTime ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD"} className={cn("mt-1 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-primary-600", phone ? "h-11 text-base" : "h-9 text-sm")} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (validDraft) { change(draft); close(); } } }} />
            </label>
            {!validDraft && <p className="mb-2 text-xs text-red-600">{legacyTextByFlag(vi, "84eec5799fdb")}</p>}
            <div className="mb-2 flex items-center justify-between">
              <button type="button" className={phone ? navButtonStyle : buttonStyle} aria-label={legacyTextByFlag(vi, "c89cb47c4a30")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></button>
              <span className={cn("font-semibold", phone ? "text-[17px]" : "text-sm")} aria-live="polite">{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month)}</span>
              <button type="button" className={phone ? navButtonStyle : buttonStyle} aria-label={legacyTextByFlag(vi, "8d5d6dafe0af")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-4" /></button>
            </div>
            <div className="grid grid-cols-7" role="grid" aria-label={chooseLabel}>
              {(vi ? ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]).map((day) => <span key={day} className={cn("text-center text-xs text-slate-500", phone ? "py-2" : "py-1")}>{day}</span>)}
              {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
              {Array.from({ length: dayCount }, (_, index) => {
                const day = isoDay(new Date(month.getFullYear(), month.getMonth(), index + 1));
                const selected = day === draft.slice(0, 10);
                return <button key={day} type="button" role="gridcell" data-day={day} aria-label={day} aria-selected={selected} disabled={Boolean((min && day < String(min).slice(0, 10)) || (max && day > String(max).slice(0, 10)))} onClick={() => pickDay(day)} className={cn(buttonStyle, selected && "bg-primary-600 font-semibold text-white hover:bg-primary-700")} onKeyDown={(event) => {
                  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
                  if (delta === undefined) return;
                  event.preventDefault();
                  const next = new Date(month.getFullYear(), month.getMonth(), index + 1 + delta);
                  const nextDay = isoDay(next);
                  if ((min && nextDay < String(min).slice(0, 10)) || (max && nextDay > String(max).slice(0, 10))) return;
                  setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
                  window.requestAnimationFrame(() => popupRef.current?.querySelector<HTMLButtonElement>(`[data-day="${nextDay}"]`)?.focus({ preventScroll: true }));
                }}>{index + 1}</button>;
              })}
            </div>
            {dateTime && <label className={cn("flex items-center justify-between gap-3 border-t border-border text-sm font-medium", phone ? "mt-3 pt-3" : "mt-2 pt-2")}>
              {legacyTextByFlag(vi, "b748baae9f10")}
              <input type="text" inputMode="numeric" aria-label={legacyTextByFlag(vi, "6013a84b2bcb")} placeholder="HH:mm" defaultValue={time} key={time} maxLength={5} pattern="[0-2][0-9]:[0-5][0-9]" className={cn("w-24 rounded-lg border border-border bg-surface px-3 outline-none focus:border-primary-600", phone ? "h-11" : "h-9")} onBlur={(event) => {
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) setDraft(`${draft.slice(0, 10) || isoDay(new Date())}T${event.target.value}`);
                else event.target.value = time;
              }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
            </label>}
            </div>
            <div className={cn("flex shrink-0 justify-between gap-2 border-t border-border pt-2", phone ? "mt-3 pt-3" : "mt-2")}>
              <button type="button" disabled={required} className="min-h-11 rounded-lg px-3 text-sm text-slate-600 hover:bg-surface-2 disabled:opacity-50" onClick={() => { change(""); close(); }}>{legacyTextByFlag(vi, "0462d45bf155")}</button>
              <button type="button" disabled={!validDraft} className="min-h-11 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => { change(draft); close(); }}>{legacyTextByFlag(vi, "7b131edeebbd")}</button>
            </div>
          </div>, document.body,
        )}
      </div>
    );
  },
);
DateInput.displayName = "DateInput";

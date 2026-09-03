"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Check } from "lucide-react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";

const colors = ["#0f766e", "#15803d", "#1d4ed8", "#7e22ce", "#be185d", "#b91c1c", "#c2410c", "#ca8a04", "#334155", "#64748b", "#000000", "#ffffff"];

export function ColorPicker({ value, onChange, label }: { value: string | null; onChange: (value: string) => void; label: string }) {
  const vi = useLocale().startsWith("vi");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "#0f766e");
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const rootRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const valid = /^#[0-9a-f]{6}$/i.test(draft);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const reposition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 280)), left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)) });
    };
    reposition();
    const focus = requestAnimationFrame(() => (popupRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]') ?? popupRef.current?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }));
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  function close() { setOpen(false); rootRef.current?.focus(); }
  function choose(next: string) { onChange(next); close(); }

  return <>
    <button ref={rootRef} type="button" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setDraft(value ?? "#0f766e"); setOpen(!open); }} className="relative grid size-11 place-items-center overflow-hidden rounded-lg border border-border bg-surface shadow-sm hover:border-primary-400 focus-visible:outline-2 focus-visible:outline-primary-600 lg:size-9">
      {value ? <span className="absolute inset-1 rounded-md" style={{ backgroundColor: value }} /> : <Ban className="size-4 text-slate-400" />}
    </button>
    {open && createPortal(<div ref={popupRef} id={id} role="dialog" aria-label={label} style={position} className="fixed z-[115] w-64 rounded-xl border border-border bg-surface p-3 text-slate-900 shadow-e2 dark:text-slate-100" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div role="listbox" aria-label={label} className="grid grid-cols-6 gap-1">
        {colors.map((color, index) => <button key={color} type="button" role="option" aria-label={color} aria-selected={value?.toLowerCase() === color} className="grid size-9 place-items-center rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600" style={{ backgroundColor: color }} onClick={() => choose(color)} onKeyDown={(event) => {
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[event.key];
          if (delta === undefined) return;
          event.preventDefault();
          popupRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[(index + delta + colors.length) % colors.length]?.focus();
        }}>{value?.toLowerCase() === color && <Check className={cn("size-4", color === "#ffffff" ? "text-slate-900" : "text-white")} />}</button>)}
      </div>
      <label className="mt-3 block text-xs font-medium">{vi ? "Mã màu HEX" : "HEX color"}
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (valid) choose(draft); } }} className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-primary-600" aria-invalid={!valid} maxLength={7} />
      </label>
      <button type="button" disabled={!valid} onClick={() => choose(draft)} className="mt-3 min-h-11 w-full rounded-lg bg-primary-600 text-sm font-semibold text-white disabled:opacity-50">{vi ? "Áp dụng" : "Apply"}</button>
    </div>, document.body)}
  </>;
}

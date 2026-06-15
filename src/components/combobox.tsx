"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, Plus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { normalizeSearch } from "@/lib/normalize";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}
/** Alias ngữ nghĩa — cùng kiểu với ComboOption. */
export type SearchableOption = ComboOption;

/**
 * SearchableSelect — picker chọn 1 mục từ danh sách, có ô tìm kiếm.
 * - Lọc bỏ dấu, không phân biệt hoa/thường (normalizeSearch, "bao ve" khớp "Bảo vệ").
 * - showSearch: mặc định AUTO (bật khi > 8 lựa chọn). Ép on/off qua prop.
 * - Điều hướng bàn phím ↑/↓/Enter/Esc; check ở mục đang chọn.
 * - onCreate: cho phép tạo mới một mục từ ô tìm (vd nhóm hàng/thương hiệu).
 * Dùng chung mọi nơi cần chọn thực thể (KH/SP/NCC/ĐVT/bảng giá/kho…).
 */
export function SearchableSelect({
  value, onChange, options, placeholder, className, allowClear = true, onCreate, showSearch, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
  onCreate?: (name: string) => Promise<string | null>;
  /** Hiện ô tìm. Mặc định auto: bật khi options.length > 8. */
  showSearch?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const searchable = showSearch ?? options.length > 8;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const nq = normalizeSearch(q);
  const filtered = useMemo(
    () => (nq ? options.filter((o) => normalizeSearch(`${o.label} ${o.hint ?? ""}`).includes(nq)) : options),
    [nq, options]
  );
  const exact = options.some((o) => normalizeSearch(o.label) === nq);

  useEffect(() => { setActive(0); }, [nq, open]);

  async function create() {
    if (!onCreate || !q.trim() || creating) return;
    setCreating(true);
    const id = await onCreate(q.trim());
    setCreating(false);
    if (id) { onChange(id); setOpen(false); setQ(""); }
  }

  function pick(v: string) { onChange(v); setOpen(false); setQ(""); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active].value);
      else if (onCreate && q.trim() && !exact) create();
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQ(""); }}
        className="w-full pl-3 pr-9 py-2 text-sm text-left rounded-[10px] border border-border bg-surface flex items-center justify-between gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={cn("truncate", !selected && "text-slate-400")}>{selected ? selected.label : (placeholder ?? "—")}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 absolute right-2.5" />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-e2 overflow-hidden animate-[fadeIn_120ms_ease]">
          {searchable && (
            <div className="relative border-b border-border-soft">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder={placeholder ?? t("search")}
                className="w-full pl-8 pr-3 py-2 text-sm bg-transparent outline-none"
              />
            </div>
          )}
          <div ref={listRef} className="max-h-64 overflow-auto py-1" onKeyDown={onKeyDown}>
            {allowClear && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-sm text-slate-400 hover:bg-surface-2">{t("clear")}</button>
            )}
            {onCreate && q.trim() && !exact && (
              <button type="button" onClick={create} disabled={creating} className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40 font-medium">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t("add")} “{q.trim()}”
              </button>
            )}
            {filtered.length === 0 && !(onCreate && q.trim()) ? (
              <div className="px-3 py-3 text-sm text-slate-400 text-center">{t("noResults")}</div>
            ) : filtered.slice(0, 200).map((o, i) => (
              <button
                key={o.value}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 hover:bg-surface-2",
                  i === active && "bg-surface-2",
                  o.value === value && "bg-primary-50 dark:bg-primary-950/40"
                )}
              >
                <span className="min-w-0 truncate">{o.label}{o.hint && <span className="text-xs text-slate-400 ml-1">{o.hint}</span>}</span>
                {o.value === value && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Alias tương thích ngược — tên cũ dùng khắp codebase. */
export const Combobox = SearchableSelect;

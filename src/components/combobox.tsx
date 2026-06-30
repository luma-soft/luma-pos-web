"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search, Check, Plus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { normalizeSearch } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

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
  value, onChange, options, placeholder, className, allowClear = true, onCreate, showSearch, disabled, actionLabel, onAction, actionIcon,
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
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: ReactNode;
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset highlighted index when query/open changes
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
      <Button
        type="button"
        variant="outline"
        block
        disabled={disabled}
        onClick={() => { setOpen((v) => !v); setQ(""); }}
        className="relative h-10 justify-start pl-3 pr-9 text-left rounded-[10px]"
      >
        <Text
          as="span"
          truncate
          variant={selected ? "default" : "muted"}
          className="text-current"
          text={selected ? selected.label : (placeholder ?? "—")}
        />
        <ChevronDown className={cn("w-4 h-4 text-slate-400 shrink-0 absolute right-2.5 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <>
          {/* mobile: nền mờ đóng sheet */}
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setOpen(false)} />
          {/* mobile: bottom-sheet · desktop: dropdown */}
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[min(80dvh,640px)] rounded-t-2xl bg-surface border border-border shadow-e2 overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom)] animate-[slideUp_180ms_ease] lg:absolute lg:inset-x-0 lg:bottom-auto lg:top-full lg:mt-1 lg:max-h-none lg:rounded-xl lg:pb-0 lg:animate-[fadeIn_120ms_ease]">
            {/* mobile header: tay nắm + tiêu đề + đóng */}
            <div className="lg:hidden">
              <div className="flex justify-center pt-2"><span className="h-1 w-9 rounded-full bg-border" /></div>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-soft">
                <Text as="span" weight="semibold" truncate text={placeholder ?? t("search")} />
                <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}>
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
            {searchable && (
              <div className="border-b border-border-soft">
                <Input
                  autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                  placeholder={placeholder ?? t("search")}
                  leftIcon={<Search />}
                  className="h-11 rounded-none border-0 bg-transparent focus:ring-0 focus:border-transparent"
                />
              </div>
            )}
            <div ref={listRef} className="overflow-auto py-1 max-h-[60dvh] lg:max-h-64" onKeyDown={onKeyDown}>
              {onAction && actionLabel && (
                <Button
                  type="button"
                  variant="ghost"
                  block
                  onClick={() => { onAction(); setOpen(false); setQ(""); }}
                  className="justify-start rounded-none px-3 py-3 lg:py-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40"
                >
                  {actionIcon ?? <Plus className="w-4 h-4" />}
                  <Text as="span" weight="medium" className="text-current" text={actionLabel} />
                </Button>
              )}
              {allowClear && (
                <Button
                  type="button"
                  variant="ghost"
                  block
                  onClick={() => { onChange(""); setOpen(false); }}
                  className="justify-start rounded-none px-3 py-3 lg:py-1.5 text-slate-400"
                  text={t("clear")}
                />
              )}
              {onCreate && q.trim() && !exact && (
                <Button
                  type="button"
                  variant="ghost"
                  block
                  onClick={create}
                  disabled={creating}
                  className="justify-start rounded-none px-3 py-3 lg:py-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <Text as="span" weight="medium" className="text-current" text={`${t("add")} “${q.trim()}”`} />
                </Button>
              )}
              {filtered.length === 0 && !(onCreate && q.trim()) ? (
                <Text as="div" variant="muted" className="px-3 py-3 text-center" text={t("noResults")} />
              ) : filtered.slice(0, 200).map((o, i) => (
                <Button
                  key={o.value}
                  type="button"
                  variant="ghost"
                  block
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    "justify-between rounded-none px-3 py-3 lg:py-1.5 text-left",
                    i === active && "bg-surface-2",
                    o.value === value && "bg-primary-50 dark:bg-primary-950/40"
                  )}
                >
                  <Text as="span" truncate className="min-w-0 text-current">
                    {o.label}{o.hint && <Text as="span" variant="muted" size="xs" className="ml-1" text={o.hint} />}
                  </Text>
                  {o.value === value && <Check className="w-4 h-4 text-primary-600 shrink-0" />}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Alias tương thích ngược — tên cũ dùng khắp codebase. */
export const Combobox = SearchableSelect;

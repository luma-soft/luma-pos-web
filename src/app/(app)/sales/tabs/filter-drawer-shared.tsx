"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Search,
} from "lucide-react";
import { FloatingMenuPortal } from "@/components/ui/floating-menu-portal";
import { selectAllInputOnClick } from "@/lib/input-selection";
import { isOrderDateRangeValid } from "@/lib/orders/filter-date-range";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string };

/**
 * Phones: filter controls render as iOS inset-grouped rows (LumaSelectField
 * `.inline`, NavigationLink rows) inside a FilterSection card. Desktop keeps the
 * bordered field look via `lg:` classes.
 */
const mobileRowBase =
  "max-lg:min-h-11 max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:px-4 max-lg:py-[11px] max-lg:text-[17px] max-lg:font-normal max-lg:hover:border-0 max-lg:active:bg-black/[0.06] max-lg:dark:active:bg-white/[0.08] max-lg:focus-visible:ring-inset";
export type EntityPickerKind =
  | "customer"
  | "product"
  | "project"
  | "order"
  | "warehouse"
  | "supplier"
  | "category"
  | "brand";
export type EntityPickerOption = {
  value: string;
  label: string;
  hint?: string;
};

const focusableSelectors =
  "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1'])";

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function deriveHint(row: Record<string, unknown>) {
  const hintValues = [
    row.hint,
    row.code,
    row.phone,
    row.sku,
    row.barcode,
    row.address,
  ];
  const values = hintValues.filter(isString).map((item) => item.trim());
  return values.length > 0 ? values.join(" · ") : undefined;
}

function parseEntityRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const rows = "rows" in payload ? (payload as { rows?: unknown }).rows : payload;
  return Array.isArray(rows) ? rows.filter((item): item is Record<string, unknown> => item != null && typeof item === "object") : [];
}

export function parseEntityOptions(payload: unknown): EntityPickerOption[] {
  return parseEntityRows(payload).flatMap((row) => {
    const value = isString(row.id)
      ? row.id
      : isString(row.value)
        ? row.value
        : "";
    const label = isString(row.label)
      ? row.label
      : isString(row.name)
        ? row.name
        : "";
    if (!value || !label) return [];
    const hint = deriveHint(row);
    return [{ value, label, ...(hint ? { hint } : {}) }];
  });
}

export function collectFocusableElements(
  container: HTMLElement | null,
): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
    (node) => {
      if (node.tabIndex < 0) return false;
      if (node.hasAttribute("disabled")) return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    },
  );
}

export function LumaWebPicker({
  label,
  ariaLabel,
  name,
  value,
  defaultValue = "",
  options,
  searchable = false,
  searchPlaceholder = "Tìm kiếm",
  rowLabel,
  onChange,
}: {
  label?: string;
  /** Phones: render as an inline iOS row with this label on the left. */
  rowLabel?: string;
  ariaLabel: string;
  name: string;
  value?: string;
  defaultValue?: string;
  options: ReadonlyArray<PickerOption>;
  searchable?: boolean;
  searchPlaceholder?: string;
  onChange?: (value: string) => void;
}) {
  const listboxId = `luma-picker-${useId().replaceAll(":", "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [internalValue, setInternalValue] = useState(defaultValue);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedValue = value ?? internalValue;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selectedValue),
  );
  const selectedOption = options[selectedIndex];
  const visibleOptions = search.trim()
    ? options.filter((option) => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : options;

  useEffect(() => {
    if (!open || !searchable) return;
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, searchable]);

  function focusOption(index: number) {
    if (visibleOptions.length === 0) return;
    const bounded = (index + visibleOptions.length) % visibleOptions.length;
    window.requestAnimationFrame(() => {
      optionRefs.current[bounded]?.focus();
    });
  }

  function openAndFocus(index: number) {
    setOpen(true);
    focusOption(index);
  }

  function select(nextValue: string) {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
    setOpen(false);
    setSearch("");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedValue} />
      {label && (
        <span className={cn("mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300", rowLabel && "max-lg:hidden")}>
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAndFocus(Math.max(0, visibleOptions.findIndex((option) => option.value === selectedValue)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAndFocus(Math.max(0, visibleOptions.findIndex((option) => option.value === selectedValue)) || visibleOptions.length - 1);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className={cn(
          "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm font-semibold outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100",
          rowLabel && mobileRowBase,
        )}
      >
        {rowLabel && <span className="min-w-0 flex-1 truncate text-ios-label lg:hidden">{rowLabel}</span>}
        <span className={cn("min-w-0 flex-1 truncate", rowLabel && "max-lg:flex-none max-lg:max-w-[55%] max-lg:text-right max-lg:text-ios-label-secondary")}>
          {selectedOption?.label ?? "Chọn"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180 text-primary-600",
            rowLabel && "max-lg:hidden",
          )}
        />
        {rowLabel && <ChevronsUpDown className="-ml-1.5 size-[15px] shrink-0 text-ios-label-secondary lg:hidden" strokeWidth={2.2} aria-hidden="true" />}
      </button>

      <FloatingMenuPortal
          open={open}
          anchorRef={triggerRef}
          onDismiss={() => setOpen(false)}
          data-luma-picker-surface={name}
          side="bottom"
          matchAnchorWidth
          maxMenuHeight={288}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn("rounded-xl border border-border bg-surface p-1.5 shadow-2xl", rowLabel && "max-lg:rounded-[14px]")}
        >
          {searchable && (
            <div className="sticky top-0 z-10 bg-surface p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onClick={selectAllInputOnClick}
                  placeholder={searchPlaceholder}
                  className="h-11 min-h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 lg:h-10 lg:min-h-0 lg:text-sm"
                />
              </div>
            </div>
          )}
          {visibleOptions.map((option, index) => {
            const selected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => select(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusOption(visibleOptions.length - 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    triggerRef.current?.focus();
                  } else if (event.key === "Tab") {
                    setOpen(false);
                  }
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold outline-none transition hover:bg-surface-2 focus-visible:bg-primary-50 focus-visible:ring-2 focus-visible:ring-primary-200 dark:focus-visible:bg-primary-950/30",
                  selected &&
                    "bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300",
                  rowLabel && "max-lg:text-[17px] max-lg:font-normal",
                )}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {selected && <Check className="size-4 shrink-0" />}
              </button>
            );
          })}
          {visibleOptions.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-slate-500">Không tìm thấy kết quả</p>
          )}
      </FloatingMenuPortal>
    </div>
  );
}

export function LumaDateRangePicker({
  fromName,
  toName,
  from,
  to,
  onChange,
  error,
  rowLabel,
}: {
  /** Phones: render as an inline iOS row with this label on the left. */
  rowLabel?: string;
  fromName: string;
  toName: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  error: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => firstInputRef.current?.focus());
  }, [open]);

  const draftValid = isOrderDateRangeValid(draftFrom, draftTo);

  return (
    <div className="relative">
      <input type="hidden" name={fromName} value={from} />
      <input type="hidden" name={toName} value={to} />
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100",
          rowLabel && mobileRowBase,
        )}
        aria-label="Chọn khoảng thời gian"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <CalendarDays className={cn("size-4 text-slate-500", rowLabel && "max-lg:hidden")} />
        {rowLabel && <span className="min-w-0 flex-1 truncate text-ios-label lg:hidden">{rowLabel}</span>}
        <span className={cn("min-w-0 flex-1 font-semibold", rowLabel && "max-lg:flex-none max-lg:font-normal max-lg:text-ios-label-secondary max-lg:tabular-nums")}>
          {from || "Từ ngày"} → {to || "Đến ngày"}
        </span>
        <ChevronDown className={cn("size-4 text-slate-400", open && "rotate-180", rowLabel && "max-lg:hidden")} />
        {rowLabel && <ChevronRight className="-ml-1.5 size-4 shrink-0 text-ios-label-tertiary lg:hidden" strokeWidth={2.4} aria-hidden="true" />}
      </button>
      {error && <p className={cn("mt-2 text-xs font-semibold text-red-600", rowLabel && "max-lg:mt-0 max-lg:px-4 max-lg:pb-2.5 max-lg:text-[13px] max-lg:font-normal")}>{error}</p>}

      <FloatingMenuPortal
          open={open}
          anchorRef={triggerRef}
          onDismiss={() => setOpen(false)}
          side="bottom"
          matchAnchorWidth
          role="dialog"
          aria-label="Chọn khoảng thời gian"
          className="rounded-xl border border-border bg-surface p-4 shadow-2xl"
        >
          <p className="text-sm font-extrabold">Khoảng thời gian</p>
          <p className="mt-1 text-xs text-slate-500">
            Định dạng YYYY-MM-DD · tối đa 1 năm
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="rounded-lg border border-border px-3 py-2 focus-within:border-primary-500">
              <span className="block text-xs text-slate-500">Từ ngày</span>
              <input
                ref={firstInputRef}
                type="text"
                inputMode="numeric"
                value={draftFrom}
                onChange={(event) => setDraftFrom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    window.requestAnimationFrame(() =>
                      document.getElementById(`${toName}-end`)?.focus(),
                    );
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                className="mt-1 w-full bg-transparent text-sm outline-none min-h-11 lg:min-h-0 min-h-11 lg:min-h-0"
              />
            </label>
            <label className="rounded-lg border border-border px-3 py-2 focus-within:border-primary-500">
              <span className="block text-xs text-slate-500">Đến ngày</span>
              <input
                id={`${toName}-end`}
                type="text"
                inputMode="numeric"
                value={draftTo}
                onChange={(event) => setDraftTo(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (draftValid) {
                      onChange(draftFrom, draftTo);
                      setOpen(false);
                    }
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                className="mt-1 w-full bg-transparent text-sm outline-none min-h-11 lg:min-h-0 min-h-11 lg:min-h-0"
              />
            </label>
          </div>

          {!draftValid && (
            <p className="mt-2 text-xs font-semibold text-red-600">
              Khoảng ngày không hợp lệ hoặc vượt quá 1 năm.
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-10 rounded-lg border border-border font-semibold min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={!draftValid}
              onClick={() => {
                onChange(draftFrom, draftTo);
                setOpen(false);
              }}
              className="min-h-10 rounded-lg bg-primary-600 font-semibold text-white disabled:opacity-50 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
            >
              Áp dụng
            </button>
          </div>
      </FloatingMenuPortal>
    </div>
  );
}

export function LumaEntityPicker({
  label,
  name,
  labelName,
  queryName,
  kind,
  endpoint = "/api/sales/filter-options",
  value,
  labelValue,
  placeholder,
  icon,
  mobileIcon,
  showLabel = true,
  onChange,
}: {
  label: string;
  /** Phones: icon of the iOS navigation row (person, box…); enables the row look. */
  mobileIcon?: ReactNode;
  name: string;
  labelName: string;
  queryName?: string;
  kind: EntityPickerKind;
  endpoint?: string;
  value: string;
  labelValue: string;
  placeholder: string;
  icon?: ReactNode;
  showLabel?: boolean;
  onChange: (next: { value: string; label: string }) => void;
}) {
  const id = useId().replaceAll(":", "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = `entity-picker-${kind}-${id}`;
  const searchRef = useRef<HTMLInputElement>(null);
  const requestToken = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EntityPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    const restoreFocus = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 0);
    return () => {
      clearTimeout(restoreFocus);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const token = ++requestToken.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const url = new URL(endpoint, window.location.origin);
        url.searchParams.set("kind", kind);
        if (query.trim()) url.searchParams.set("q", query.trim());
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("request_failed");
        const payload = (await response.json()) as { ok?: boolean; data?: unknown };
        if (!payload.ok) throw new Error("request_failed");
        if (token !== requestToken.current) return;
        setOptions(parseEntityOptions(payload.data));
        setActiveIndex(0);
      } catch (requestError) {
        if ((requestError as Error).name === "AbortError") return;
        if (token === requestToken.current) {
          setOptions([]);
          setError("Không thể tải danh sách. Vui lòng thử lại.");
        }
      } finally {
        if (!controller.signal.aborted && token === requestToken.current) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [endpoint, kind, open, query]);

  function pick(option: EntityPickerOption) {
    onChange({ value: option.value, label: option.label });
    setOpen(false);
    setQuery("");
  }

  function clearSelection() {
    onChange({ value: "", label: "" });
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name={labelName} value={labelValue} />
      {queryName && <input type="hidden" name={queryName} value={labelValue} />}

      {showLabel ? (
        <span className={cn("mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300", mobileIcon != null && "max-lg:hidden")}>
          {label}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() =>
          setOpen((current) => {
            if (!current) window.requestAnimationFrame(() => searchRef.current?.focus());
            return !current;
          })
        }
        className={cn(
          "flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100",
          mobileIcon != null && cn(mobileRowBase, "max-lg:min-h-[52px] max-lg:gap-2.5 max-lg:py-2"),
        )}
      >
        {mobileIcon != null && (
          // NativeInvoiceFilterSheet.filterRow: 20pt secondary symbol, 15pt title, 12pt value.
          <span className="grid w-5 shrink-0 place-items-center text-ios-label-secondary lg:hidden [&>svg]:size-[19px]">{mobileIcon}</span>
        )}
        {mobileIcon != null && (
          <span className="min-w-0 flex-1 lg:hidden">
            <span className="block text-[15px] leading-5 text-ios-label">{label}</span>
            {labelValue && <span className="block truncate text-[12px] leading-4 text-ios-label-secondary">{labelValue}</span>}
          </span>
        )}
        {icon ? <span className={cn("shrink-0 text-slate-500", mobileIcon != null && "max-lg:hidden")}>{icon}</span> : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            value || labelValue ? "font-semibold" : "text-slate-400",
            mobileIcon != null && "max-lg:hidden",
          )}
        >
          {labelValue || placeholder}
        </span>
        <ChevronRight className={cn("size-4 shrink-0 text-slate-400", mobileIcon != null && "max-lg:text-ios-label-tertiary")} strokeWidth={mobileIcon != null ? 2.4 : 2} />
      </button>

      <FloatingMenuPortal
        open={open}
        anchorRef={triggerRef}
        onDismiss={() => setOpen(false)}
        data-luma-picker-surface={name}
        side="bottom"
        matchAnchorWidth
        maxMenuHeight={360}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl",
          // NativeInvoiceFilterPickerView is a pushed full-screen list on phones.
          mobileIcon != null && "max-lg:!inset-0 max-lg:!h-auto max-lg:!max-h-none max-lg:!w-auto max-lg:rounded-none max-lg:border-0 max-lg:bg-canvas max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)] max-lg:shadow-none",
        )}
      >
          {mobileIcon != null && (
            <div className="flex items-center gap-3 px-ios-inset pb-1 pt-2 lg:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Quay lại"
                data-button-radius="pill"
                className="grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface text-ios-label shadow-[0_2px_10px_rgb(0_0_0/0.08)] dark:border-white/10"
              >
                <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
              </button>
              <span className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">{label}</span>
              <span className="size-11 shrink-0" aria-hidden="true" />
            </div>
          )}
          <div className={cn("relative border-b border-border p-3", mobileIcon != null && "max-lg:border-0 max-lg:px-ios-inset max-lg:py-ios-search")}>
            <Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              onClick={selectAllInputOnClick}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) =>
                    Math.min(options.length - 1, index + 1),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(0, index - 1));
                } else if (event.key === "Enter" && options[activeIndex]) {
                  event.preventDefault();
                  pick(options[activeIndex]);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
              placeholder={placeholder}
              aria-label={`Tìm ${label.toLocaleLowerCase("vi")}`}
              className={cn(
                "h-11 min-h-11 w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 lg:h-10 lg:min-h-0",
                mobileIcon != null && "max-lg:h-10 max-lg:min-h-10 max-lg:rounded-[10px] max-lg:border-0 max-lg:bg-[rgb(118_118_128/0.12)] max-lg:text-[17px] max-lg:focus:ring-0",
              )}
            />
          </div>
          <div id={listboxId} role="listbox" className={cn("min-h-0 overflow-y-auto py-1", mobileIcon != null && "max-lg:mx-ios-inset max-lg:mb-3 max-lg:rounded-[26px] max-lg:bg-surface max-lg:py-0 max-lg:[&>button:not(:last-child)]:border-b max-lg:[&>button:not(:last-child)]:border-border max-lg:[&>button]:min-h-[52px] max-lg:[&>button]:text-[17px]")}>
            {value && (
              <button
                type="button"
                onClick={clearSelection}
                className="flex min-h-11 w-full items-center px-4 text-left text-sm font-semibold text-slate-500 hover:bg-surface-2"
              >
                Bỏ lựa chọn
              </button>
            )}
            {loading ? (
              <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Đang tải...
              </div>
            ) : error ? (
              <p className="px-4 py-5 text-center text-sm text-red-600">{error}</p>
            ) : options.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-slate-500">
                Không tìm thấy kết quả
              </p>
            ) : (
              options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left outline-none transition hover:bg-surface-2",
                    index === activeIndex && "bg-surface-2",
                    option.value === value && "bg-primary-50 text-primary-700",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-semibold", mobileIcon != null && "max-lg:text-[17px] max-lg:font-normal")}>
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className={cn("mt-0.5 block truncate text-xs text-slate-500", mobileIcon != null && "max-lg:text-[13px] max-lg:text-ios-label-secondary")}>
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {option.value === value && (
                    <Check className="size-4 shrink-0 text-primary-600" />
                  )}
                </button>
              ))
            )}
          </div>
      </FloatingMenuPortal>
    </div>
  );
}

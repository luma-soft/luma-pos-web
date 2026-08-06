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
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import { isOrderDateRangeValid } from "@/lib/orders/filter-date-range";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string };
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
  onChange,
}: {
  label?: string;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [internalValue, setInternalValue] = useState(defaultValue);
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
    if (!open) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [open]);

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
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={selectedValue} />
      {label && (
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
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
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm font-semibold outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption?.label ?? "Chọn"}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180 text-primary-600",
          )}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-2xl"
        >
          {searchable && (
            <div className="sticky top-0 z-10 bg-surface p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="min-h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
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
        </div>
      )}
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
}: {
  fromName: string;
  toName: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  error: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    window.requestAnimationFrame(() => firstInputRef.current?.focus());
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [open]);

  const draftValid = isOrderDateRangeValid(draftFrom, draftTo);

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={fromName} value={from} />
      <input type="hidden" name={toName} value={to} />
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"
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
        <CalendarDays className="size-4 text-slate-500" />
        <span className="min-w-0 flex-1 font-semibold">
          {from || "Từ ngày"} → {to || "Đến ngày"}
        </span>
        <ChevronDown className={cn("size-4 text-slate-400", open && "rotate-180")} />
      </button>
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

      {open && (
        <div
          role="dialog"
          aria-label="Chọn khoảng thời gian"
          className="absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-border bg-surface p-4 shadow-2xl"
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
                className="mt-1 w-full bg-transparent text-sm outline-none"
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
                className="mt-1 w-full bg-transparent text-sm outline-none"
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
              className="min-h-10 rounded-lg border border-border font-semibold"
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
              className="min-h-10 rounded-lg bg-primary-600 font-semibold text-white disabled:opacity-50"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}
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
  onChange,
}: {
  label: string;
  name: string;
  labelName: string;
  queryName?: string;
  kind: EntityPickerKind;
  endpoint?: string;
  value: string;
  labelValue: string;
  placeholder: string;
  icon?: ReactNode;
  onChange: (next: { value: string; label: string }) => void;
}) {
  const id = useId().replaceAll(":", "");
  const rootRef = useRef<HTMLDivElement>(null);
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
    const onOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const restoreFocus = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 0);
    document.addEventListener("mousedown", onOutsideClick);
    return () => {
      clearTimeout(restoreFocus);
      document.removeEventListener("mousedown", onOutsideClick);
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
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name={labelName} value={labelValue} />
      {queryName && <input type="hidden" name={queryName} value={labelValue} />}

      <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
      </span>
      <button
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
        className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left outline-none transition hover:border-primary-300 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100"
      >
        {icon ? <span className="shrink-0 text-slate-500">{icon}</span> : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            value || labelValue ? "font-semibold" : "text-slate-400",
          )}
        >
          {labelValue || placeholder}
        </span>
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="relative border-b border-border p-3">
            <Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
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
              className="min-h-10 w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto py-1">
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
                    <span className="block truncate text-sm font-semibold">
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
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
        </div>
      )}
    </div>
  );
}

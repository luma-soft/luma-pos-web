"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/normalize";
import type { TxValues } from "./_tx";

export interface SelectOption {
  value: string;
  label: string;
  /** i18n key for label */
  labelTx?: string;
}

export interface SelectProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onChange" | "value" | "defaultValue" | "name" | "size"> {
  options: SelectOption[];
  size?: "sm" | "default" | "lg";
  variant?: "default" | "error";
  name?: string;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onValueChange?: (value: string) => void;
  /** Plain placeholder text */
  placeholder?: string;
  placeholderTx?: string;
  placeholderTxOptions?: TxValues;
  /** Keep long labels readable instead of truncating them. */
  wrapLabel?: boolean;
  /** Applied to each portaled option row (for route-scoped touch sizing). */
  optionClassName?: string;
  /** Applied to the non-portaled root wrapper when Select participates in flex/grid layout. */
  rootClassName?: string;
  /** Minimum width in pixels for the portaled options menu. */
  menuMinWidth?: number;
  /** Show a search field above the options list. */
  searchable?: boolean;
  /** Plain placeholder text for the option search field. */
  searchPlaceholder?: string;
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      options,
      size = "default",
      variant = "default",
      name,
      value,
      defaultValue,
      onChange,
      onValueChange,
      placeholder,
      placeholderTx,
      placeholderTxOptions,
      wrapLabel = false,
      optionClassName,
      rootClassName,
      menuMinWidth,
      searchable = false,
      searchPlaceholder,
      disabled,
      onKeyDown,
      ...props
    },
    ref
  ) => {
    const t = useTranslations();
    const ph = placeholderTx ? t(placeholderTx, placeholderTxOptions) : placeholder;
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(() => stringValue(defaultValue));
    const [open, setOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(null);
    const generatedId = React.useId();
    const triggerId = props.id ?? `${generatedId}-trigger`;
    const listboxId = `${generatedId}-listbox`;
    const rootRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const initializedFocusRef = React.useRef(false);
    const openingFocusRef = React.useRef<"selected" | "first" | "last" | "search">("selected");
    React.useImperativeHandle(ref, () => triggerRef.current!, []);
    const currentValue = controlled ? stringValue(value) : internalValue;
    const selected = options.find((option) => option.value === currentValue);
    const selectedLabel = selected ? optionLabel(selected, t) : ph;
    const normalizedQuery = normalizeSearch(searchQuery);
    const filteredOptions = normalizedQuery
      ? options.filter((option) =>
          matchesSelectSearch(optionLabel(option, t), normalizedQuery),
        )
      : options;

    const updateMenuPosition = React.useCallback(() => {
      const root = rootRef.current;
      if (!root || typeof window === "undefined") return;
      const rect = root.getBoundingClientRect();
      const margin = 8;
      const maxWidth = Math.max(0, window.innerWidth - margin * 2);
      const width = Math.min(
        Math.max(rect.width, menuMinWidth ?? 0),
        maxWidth,
      );
      const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin));
      const availableBelow = window.innerHeight - rect.bottom - margin;
      const availableAbove = rect.top - margin;
      const placeAbove = availableBelow < 180 && availableAbove > availableBelow;
      const maxHeight = Math.max(160, Math.min(256, (placeAbove ? availableAbove : availableBelow) - 4));
      setMenuStyle({
        position: "fixed",
        left,
        top: placeAbove ? undefined : rect.bottom + 4,
        bottom: placeAbove ? window.innerHeight - rect.top + 4 : undefined,
        width,
        maxHeight,
      });
    }, [menuMinWidth]);

    React.useLayoutEffect(() => {
      if (!open) return;
      updateMenuPosition();
    }, [open, updateMenuPosition]);

    React.useLayoutEffect(() => {
      if (!open) {
        initializedFocusRef.current = false;
        return;
      }
      // The first render has no positioned portal yet. Focus only after it mounts.
      if (!menuRef.current || initializedFocusRef.current) return;
      initializedFocusRef.current = true;
      if (searchable && openingFocusRef.current === "search") {
        searchRef.current?.focus();
        return;
      }
      const options = Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
      const target = openingFocusRef.current === "last"
        ? options.at(-1)
        : openingFocusRef.current === "first" ? options[0] : selected ?? options[0];
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    }, [open, menuStyle, searchable]);

    React.useEffect(() => {
      if (!open) return;
      const onPointerDown = (event: MouseEvent) => {
        const target = event.target as Node;
        const inRoot = rootRef.current?.contains(target);
        const inMenu = menuRef.current?.contains(target);
        if (!inRoot && !inMenu) setOpen(false);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      };
      const onFocusOutside = (event: FocusEvent) => {
        const target = event.target as Node;
        if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
      };
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("focusin", onFocusOutside);
      window.addEventListener("resize", updateMenuPosition);
      window.addEventListener("scroll", updateMenuPosition, true);
      return () => {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("focusin", onFocusOutside);
        window.removeEventListener("resize", updateMenuPosition);
        window.removeEventListener("scroll", updateMenuPosition, true);
      };
    }, [open, updateMenuPosition]);

    function pick(nextValue: string) {
      if (!controlled) setInternalValue(nextValue);
      onValueChange?.(nextValue);
      if (onChange) {
        onChange({
          target: { value: nextValue, name },
          currentTarget: { value: nextValue, name },
        } as React.ChangeEvent<HTMLSelectElement>);
      }
      if (typeof window !== "undefined") {
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("luma:select-change", { detail: { name, value: nextValue } })));
      }
      setSearchQuery("");
      setOpen(false);
      triggerRef.current?.focus();
    }

    function toggleOpen() {
      if (!open) {
        setSearchQuery("");
        openingFocusRef.current = searchable ? "search" : "selected";
      }
      setOpen(!open);
    }

    function focusOption(key: string) {
      const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = selectFocusIndex(key, current, options.length);
      if (next === null || next < 0) return;
      options[next]?.focus({ preventScroll: true });
      options[next]?.scrollIntoView({ block: "nearest" });
    }

    function dismissWithEscape(event: React.KeyboardEvent) {
      event.preventDefault();
      // A picker inside a dialog consumes Escape before the enclosing dialog sees it.
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    const sizeCls = {
      sm: "h-11 px-2.5 pr-8 text-base lg:h-8 lg:text-xs",
      default: "h-11 px-3 pr-9 text-base lg:h-10 lg:text-sm",
      lg: "h-12 px-4 pr-10 text-base",
    }[size];

    const variantCls = {
      default: "border-border focus:border-primary-600",
      error: "border-red-500 focus:border-red-500",
    }[variant];

    return (
      <div ref={rootRef} className={cn("relative inline-block align-middle", rootClassName)}>
        {name && <input type="hidden" name={name} value={currentValue} />}
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          onClick={toggleOpen}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || disabled) return;
            if (open && event.key === "Escape") {
              dismissWithEscape(event);
              return;
            }
            if (selectFocusIndex(event.key, -1, options.length) === null) return;
            event.preventDefault();
            if (open) {
              focusOption(event.key);
              return;
            }
            openingFocusRef.current = event.key === "Home" ? "first"
              : event.key === "End" ? "last"
              : selected && !searchable ? "selected"
              : event.key === "ArrowUp" ? "last" : "first";
            setSearchQuery("");
            setOpen(true);
          }}
          className={cn(
            "relative min-h-11 min-w-11 w-full rounded-lg border bg-surface text-left transition-[border-color,background-color] duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:min-w-0",
            sizeCls,
            variantCls,
            wrapLabel && "h-auto min-h-11 py-2 lg:min-h-10",
            !selected && "text-slate-400",
            className,
            "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
          )}
          {...props}
        >
          <span className={cn("block", wrapLabel ? "whitespace-normal break-words pr-1" : "truncate")}>{selectedLabel ?? "—"}</span>
          <ChevronDown className={cn("absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none transition-transform", open && "rotate-180")} />
        </button>
        {open && !disabled && menuStyle && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                dismissWithEscape(event);
                return;
              }
              if (event.key === "Tab") {
                // Let the browser continue from the trigger to the next/previous field.
                setOpen(false);
                triggerRef.current?.focus();
                return;
              }
              if (event.target === searchRef.current && (event.key === "Home" || event.key === "End")) return;
              if (selectFocusIndex(event.key, -1, filteredOptions.length) === null) return;
              event.preventDefault();
              event.stopPropagation();
              focusOption(event.key);
            }}
            className="z-[100] flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-e2"
          >
            {searchable && (
              <div className="shrink-0 border-b border-border-soft bg-surface p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || filteredOptions.length === 0)
                        return;
                      event.preventDefault();
                      pick(filteredOptions[0].value);
                    }}
                    placeholder={searchPlaceholder ?? t("common.search")}
                    aria-label={searchPlaceholder ?? t("common.search")}
                    autoComplete="off"
                    className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary-600 min-h-11 lg:min-h-0"
                  />
                </div>
              </div>
            )}
            <div id={listboxId} role="listbox" aria-labelledby={triggerId} className="min-h-0 overflow-auto py-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => {
                  const active = option.value === currentValue;
                  return (
                    <SelectOptionRow
                      key={option.value}
                      active={active}
                      wrapLabel={wrapLabel}
                      onSelect={() => pick(option.value)}
                      className={optionClassName}
                      label={optionLabel(option, t)}
                    />
                  );
                })
              ) : (
                <div className="px-3 py-6 text-center text-sm text-slate-400">
                  {t("common.noResults")}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }
);
Select.displayName = "Select";

export function matchesSelectSearch(label: string, query: string) {
  return normalizeSearch(label).includes(normalizeSearch(query));
}

export function selectFocusIndex(key: string, current: number, count: number): number | null {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return null;
  if (count === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (current < 0) return key === "ArrowUp" ? count - 1 : 0;
  return (current + (key === "ArrowDown" ? 1 : -1) + count) % count;
}

export function SelectOptionRow({
  active,
  wrapLabel,
  onSelect,
  className,
  label,
}: {
  active: boolean;
  wrapLabel: boolean;
  onSelect: () => void;
  className?: string;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 lg:min-h-0",
        "focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600",
        active && "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200",
        className,
        "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
      )}
    >
      <span className={cn("min-w-0", wrapLabel ? "whitespace-normal break-words" : "truncate")}>{label}</span>
      {active && <Check className="h-4 w-4 shrink-0 text-primary-600" />}
    </button>
  );
}

function stringValue(value: SelectProps["value"] | SelectProps["defaultValue"]) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value == null ? "" : String(value);
}

function optionLabel(option: SelectOption, t: ReturnType<typeof useTranslations>) {
  return option.labelTx ? safeT(t, option.labelTx) : option.label;
}

function safeT(t: ReturnType<typeof useTranslations>, key: string) {
  try { return t(key); } catch { return key; }
}

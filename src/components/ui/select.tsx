"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
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
      disabled,
      ...props
    },
    ref
  ) => {
    const t = useTranslations();
    const ph = placeholderTx ? t(placeholderTx, placeholderTxOptions) : placeholder;
    const controlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(() => stringValue(defaultValue));
    const [open, setOpen] = React.useState(false);
    const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(null);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const currentValue = controlled ? stringValue(value) : internalValue;
    const selected = options.find((option) => option.value === currentValue);
    const selectedLabel = selected ? optionLabel(selected, t) : ph;

    const updateMenuPosition = React.useCallback(() => {
      const root = rootRef.current;
      if (!root || typeof window === "undefined") return;
      const rect = root.getBoundingClientRect();
      const margin = 8;
      const width = rect.width;
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
    }, []);

    React.useLayoutEffect(() => {
      if (open) updateMenuPosition();
    }, [open, updateMenuPosition]);

    React.useEffect(() => {
      if (!open) return;
      const onPointerDown = (event: MouseEvent) => {
        const target = event.target as Node;
        const inRoot = rootRef.current?.contains(target);
        const inMenu = menuRef.current?.contains(target);
        if (!inRoot && !inMenu) setOpen(false);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      window.addEventListener("resize", updateMenuPosition);
      window.addEventListener("scroll", updateMenuPosition, true);
      return () => {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
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
      setOpen(false);
    }

    const sizeCls = {
      sm: "h-8 px-2.5 pr-8 text-xs",
      default: "h-10 px-3 pr-9 text-sm",
      lg: "h-12 px-4 pr-10 text-base",
    }[size];

    const variantCls = {
      default: "border-border focus:ring-primary-500/30 focus:border-primary-500",
      error: "border-red-500 focus:ring-red-500/30 focus:border-red-500",
    }[variant];

    return (
      <div ref={rootRef} className="relative inline-block align-middle">
        {name && <input type="hidden" name={name} value={currentValue} />}
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((state) => !state)}
          className={cn(
            "relative w-full rounded-lg border bg-surface text-left transition-[border-color,box-shadow,background-color] duration-150 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
            sizeCls,
            variantCls,
            !selected && "text-slate-400",
            className
          )}
          {...props}
        >
          <span className="block truncate">{selectedLabel ?? "—"}</span>
          <ChevronDown className={cn("absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none transition-transform", open && "rotate-180")} />
        </button>
        {open && !disabled && menuStyle && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className="z-[100] overflow-auto rounded-lg border border-border bg-surface py-1 shadow-e2"
          >
            {options.map((option) => {
              const active = option.value === currentValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(option.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2",
                    active && "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                  )}
                >
                  <span className="min-w-0 truncate">{optionLabel(option, t)}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary-600" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </div>
    );
  }
);
Select.displayName = "Select";

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

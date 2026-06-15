"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
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
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: SelectOption[];
  size?: "sm" | "default" | "lg";
  variant?: "default" | "error";
  /** Plain placeholder text */
  placeholder?: string;
  placeholderTx?: string;
  placeholderTxOptions?: TxValues;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className, options, size = "default", variant = "default", placeholder, placeholderTx, placeholderTxOptions, ...props },
    ref
  ) => {
    const t = useTranslations();
    const ph = placeholderTx ? t(placeholderTx, placeholderTxOptions) : placeholder;

    const sizeCls = {
      sm: "h-8 px-2 pr-7 text-xs",
      default: "h-10 px-3 pr-9 text-sm",
      lg: "h-12 px-4 pr-10 text-base",
    }[size];

    const variantCls = {
      default: "border-border",
      error: "border-red-500 focus:ring-red-500",
    }[variant];

    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "ui-select appearance-none w-full rounded-lg border bg-surface transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50",
            sizeCls,
            variantCls,
            !props.value && "text-slate-400",
            className
          )}
          {...props}
        >
          {ph !== undefined && (
            <option value="" disabled hidden>
              {ph}
            </option>
          )}
          {options.map((opt) => (
            <SelectOptionItem key={opt.value} option={opt} t={t} />
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
    );
  }
);
Select.displayName = "Select";

function SelectOptionItem({
  option,
  t,
}: {
  option: SelectOption;
  t: ReturnType<typeof useTranslations>;
}) {
  const label = option.labelTx ? safeT(t, option.labelTx) : option.label;
  return (
    <option value={option.value}>
      {label}
    </option>
  );
}

function safeT(t: ReturnType<typeof useTranslations>, key: string) {
  try { return t(key); } catch { return key; }
}

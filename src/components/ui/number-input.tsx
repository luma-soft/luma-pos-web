"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";
import { Text } from "./text";

export interface NumberInputProps
  extends Omit<InputProps, "type" | "value" | "onChange" | "defaultValue"> {
  value?: number | null;
  defaultValue?: number;
  onChange?: (value: number | null) => void;
  /** Show thousand separators (1,000,000) */
  thousandSeparator?: boolean;
  /** Suffix text (e.g. "đ", "%", "kg") */
  suffix?: string;
  /** Prefix text */
  prefix?: string;
  min?: number;
  max?: number;
  decimals?: number;
}

const formatNumber = (val: number, sep: boolean, decimals = 0): string => {
  if (sep) {
    return new Intl.NumberFormat("vi-VN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(val);
  }
  if (decimals <= 0) return String(val);
  const factor = 10 ** decimals;
  return String(Math.round(val * factor) / factor);
};

const parseNumber = (str: string): number | null => {
  const cleaned = str.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
};

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, defaultValue, onChange, thousandSeparator = true, suffix, prefix, min, max, decimals = 0, className, name, ...props }, ref) => {
    const initialValue = value ?? defaultValue ?? null;
    const [text, setText] = React.useState<string>(
      value != null ? formatNumber(value, thousandSeparator, decimals) :
      defaultValue != null ? formatNumber(defaultValue, thousandSeparator, decimals) : ""
    );
    const [numericValue, setNumericValue] = React.useState<number | null>(
      initialValue,
    );

    React.useEffect(() => {
      if (value != null) {
        setText(formatNumber(value, thousandSeparator, decimals));
        setNumericValue(value);
      } else if (value === null) {
        setText("");
        setNumericValue(null);
      }
    }, [value, thousandSeparator, decimals]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      const parsed = parseNumber(raw);

      if (parsed !== null) {
        const clamped = Math.min(
          max ?? Number.POSITIVE_INFINITY,
          Math.max(min ?? Number.NEGATIVE_INFINITY, parsed),
        );
        setText(
          clamped === parsed
            ? raw
            : formatNumber(clamped, thousandSeparator, decimals),
        );
        setNumericValue(clamped);
        onChange?.(clamped);
        return;
      }
      setText(raw);
      setNumericValue(null);
      onChange?.(null);
    }

    function handleBlur() {
      const parsed = parseNumber(text);
      if (parsed !== null) {
        const clamped = Math.min(
          max ?? Number.POSITIVE_INFINITY,
          Math.max(min ?? Number.NEGATIVE_INFINITY, parsed),
        );
        setText(formatNumber(clamped, thousandSeparator, decimals));
        setNumericValue(clamped);
      } else {
        setText("");
        setNumericValue(null);
      }
    }

    return (
      <div className="relative">
        {name && <input type="hidden" name={name} value={numericValue ?? ""} />}
        {prefix && (
          <Text as="span" variant="muted" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" text={prefix} />
        )}
        <Input
          ref={ref}
          type="text"
          inputMode="decimal"
          name={undefined}
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          className={cn(
            prefix && "pl-7",
            suffix && "pr-10",
            "text-right tabular-nums",
            className,
            "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
          )}
          {...props}
        />
        {suffix && (
          <Text as="span" variant="muted" className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" text={suffix} />
        )}
      </div>
    );
  }
);
NumberInput.displayName = "NumberInput";

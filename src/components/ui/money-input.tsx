"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoneyInput, parseMoneyInput, readMoneyInput } from "./money-input-format";

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Giá trị: số, hoặc chuỗi số. null/undefined/"" = rỗng. */
  value: number | string | null | undefined;
  /** Trả về số đã parse (null nếu rỗng). */
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Opt in to comma-decimal VND editing; existing integer callers stay unchanged. */
  decimals?: number;
}

/**
 * Input tiền VND với mask phân cách hàng nghìn sống (1.000.000) ngay khi gõ.
 * Render thẳng <input> (không bọc div) → giữ nguyên className/width của chỗ dùng,
 * an toàn trong ô bảng và layout inline.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, min = 0, max, decimals = 0, onFocus, onBlur, className, ...props }, ref) => {
    const format = (amount: number | null) => formatMoneyInput(amount, decimals);
    const parse = (input: string, negative: boolean) => parseMoneyInput(input, negative, decimals);
    const [text, setText] = React.useState<string>(() => format(toNum(value)));
    const editing = React.useRef(false);
    const focusValue = React.useRef(toNum(value));
    const invalid = React.useRef(false);

    // đồng bộ khi value đổi từ ngoài — không phá lúc người dùng đang gõ
    React.useEffect(() => {
      if (!editing.current) setText(formatMoneyInput(toNum(value), decimals));
    }, [value, decimals]);

    return (
      <input
        ref={ref}
        type="text"
        inputMode={min < 0 ? "text" : decimals > 0 ? "decimal" : "numeric"}
        className={cn(
          "min-h-11 min-w-11 lg:min-h-0 lg:min-w-0",
          className,
          "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
        )}
        value={text}
        onFocus={(e) => {
          editing.current = true;
          focusValue.current = toNum(value);
          onFocus?.(e);
        }}
        onChange={(e) => {
          if (decimals > 0 && !readMoneyInput(e.target.value, min < 0, decimals).valid) {
            invalid.current = true;
            e.currentTarget.setCustomValidity("Nhập số tiền hợp lệ, dùng dấu phẩy cho phần lẻ.");
            setText(e.target.value);
            return;
          }
          invalid.current = false;
          e.currentTarget.setCustomValidity("");
          if (min < 0 && e.target.value.trim() === "-") {
            setText("-");
            onChange?.(null);
            return;
          }
          const parsed = parse(e.target.value, min < 0);
          let n = parsed;
          if (n != null) {
            if (min != null && n < min) n = min;
            if (max != null && n > max) n = max;
          }
          // Keep a trailing comma while typing a fraction (e.g. "33,").
          setText(decimals > 0 && n === parsed
            ? e.target.value.replace(min < 0 ? /[^\d.,-]/g : /[^\d.,]/g, "")
            : format(n));
          onChange?.(n);
        }}
        onBlur={(e) => {
          editing.current = false;
          if (invalid.current) {
            // Restore the value from before this edit and never commit malformed
            // text as null/zero through the parent's blur handler.
            setText(format(focusValue.current));
            onChange?.(focusValue.current);
            invalid.current = false;
            e.currentTarget.setCustomValidity("");
            return;
          }
          setText(format(parse(text, min < 0)));
          onBlur?.(e);
        }}
        {...props}
      />
    );
  }
);
MoneyInput.displayName = "MoneyInput";

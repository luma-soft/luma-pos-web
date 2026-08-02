"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("vi-VN");

/** Lấy số nguyên từ chuỗi. Khi min âm, giữ dấu trừ để nhập số dư có dấu. */
function parse(s: string, allowNegative = false): number | null {
  const digits = s.replace(/[^\d]/g, "");
  if (digits === "") return null;
  const n = parseInt(digits, 10);
  if (Number.isNaN(n)) return null;
  return allowNegative && s.trim().startsWith("-") ? -n : n;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

function format(n: number | null): string {
  return n == null ? "" : nf.format(n);
}

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Giá trị: số, hoặc chuỗi số. null/undefined/"" = rỗng. */
  value: number | string | null | undefined;
  /** Trả về số đã parse (null nếu rỗng). */
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
}

/**
 * Input tiền VND với mask phân cách hàng nghìn sống (1.000.000) ngay khi gõ.
 * Render thẳng <input> (không bọc div) → giữ nguyên className/width của chỗ dùng,
 * an toàn trong ô bảng và layout inline.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, min = 0, max, onFocus, onBlur, className, ...props }, ref) => {
    const [text, setText] = React.useState<string>(() => format(toNum(value)));
    const editing = React.useRef(false);

    // đồng bộ khi value đổi từ ngoài — không phá lúc người dùng đang gõ
    React.useEffect(() => {
      if (!editing.current) setText(format(toNum(value)));
    }, [value]);

    return (
      <input
        ref={ref}
        type="text"
        inputMode={min < 0 ? "text" : "numeric"}
        className={cn(
          "min-h-11 min-w-11 lg:min-h-0 lg:min-w-0",
          className,
          "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
        )}
        value={text}
        onFocus={(e) => {
          editing.current = true;
          onFocus?.(e);
        }}
        onChange={(e) => {
          if (min < 0 && e.target.value.trim() === "-") {
            setText("-");
            onChange?.(null);
            return;
          }
          let n = parse(e.target.value, min < 0);
          if (n != null) {
            if (min != null && n < min) n = min;
            if (max != null && n > max) n = max;
          }
          setText(format(n));
          onChange?.(n);
        }}
        onBlur={(e) => {
          editing.current = false;
          setText(format(parse(text, min < 0)));
          onBlur?.(e);
        }}
        {...props}
      />
    );
  }
);
MoneyInput.displayName = "MoneyInput";

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoneyInput, formatMoneyInputDraft, moneyInputCaret, moneyInputEditText, parseMoneyInput, readMoneyInput } from "./money-input-format";

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type"> {
  /** Giá trị: số, hoặc chuỗi số. null/undefined/"" = rỗng. */
  value?: number | string | null;
  defaultValue?: number | string | null;
  /** Optional currency/unit suffix, e.g. đ or đ/m. */
  suffix?: string;
  /** Trả về số đã parse (null nếu rỗng). */
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Opt in to comma-decimal VND editing; existing integer callers stay unchanged. */
  decimals?: number;
}

/**
 * Input tiền VND với mask phân cách hàng nghìn sống (1.000.000) ngay khi gõ.
 * Không thêm wrapper khi không có suffix → giữ className/width của chỗ dùng,
 * an toàn trong ô bảng và layout inline.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, defaultValue, onChange, min = 0, max, decimals = 0, suffix, name, disabled, form, style, onFocus, onBlur, className, ...props }, ref) => {
    const format = (amount: number | null) => formatMoneyInput(amount, decimals);
    const parse = (input: string, negative: boolean) => parseMoneyInput(input, negative, decimals);
    const initialValue = toNum(value === undefined ? defaultValue : value);
    const [text, setText] = React.useState<string>(() => format(initialValue));
    const [numericValue, setNumericValue] = React.useState(initialValue);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const selection = React.useRef<number | null>(null);
    React.useImperativeHandle(ref, () => inputRef.current!, []);
    React.useLayoutEffect(() => {
      if (selection.current != null) {
        inputRef.current?.setSelectionRange(selection.current, selection.current);
        selection.current = null;
      }
    });
    const editing = React.useRef(false);
    const focusValue = React.useRef(initialValue);
    const invalid = React.useRef(false);

    // đồng bộ khi value đổi từ ngoài — không phá lúc người dùng đang gõ
    React.useEffect(() => {
      if (!editing.current && value !== undefined) {
        setText(formatMoneyInput(toNum(value), decimals));
        setNumericValue(toNum(value));
      }
    }, [value, decimals]);

    React.useEffect(() => {
      const owner = inputRef.current?.form;
      if (!owner) return;
      const reset = () => {
        editing.current = false;
        invalid.current = false;
        inputRef.current?.setCustomValidity("");
        const resetValue = toNum(value === undefined ? defaultValue : value);
        setText(formatMoneyInput(resetValue, decimals));
        setNumericValue(resetValue);
      };
      owner.addEventListener("reset", reset);
      return () => owner.removeEventListener("reset", reset);
    }, [value, defaultValue, decimals, form]);

    const input = (
      <input
        ref={inputRef}
        type="text"
        inputMode={min < 0 ? "text" : decimals > 0 ? "decimal" : "numeric"}
        disabled={disabled}
        form={form}
        style={{ ...style, ...(suffix ? { paddingRight: `calc(1rem + ${Array.from(suffix).length}ch)` } : {}) }}
        className={cn(
          suffix && "h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-right tabular-nums outline-none placeholder:text-slate-400 focus:border-primary-600 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10 lg:text-sm",
          "min-h-11 min-w-11 lg:min-h-0 lg:min-w-0",
          className,
          "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
        )}
        value={text}
        onFocus={(e) => {
          editing.current = true;
          focusValue.current = numericValue;
          onFocus?.(e);
        }}
        onChange={(e) => {
          const native = e.nativeEvent as InputEvent;
          const raw = moneyInputEditText(e.target.value, text, native.inputType ?? "", native.data, decimals);
          if (!(min < 0 && raw.trim() === "-") && !readMoneyInput(raw, min < 0, decimals).valid) {
            invalid.current = true;
            e.currentTarget.setCustomValidity("Nhập số tiền hợp lệ.");
            setText(e.target.value);
            return;
          }
          invalid.current = false;
          e.currentTarget.setCustomValidity("");
          if (min < 0 && raw.trim() === "-") {
            setText("-");
            setNumericValue(null);
            onChange?.(null);
            return;
          }
          const parsed = parse(raw, min < 0);
          let n = parsed;
          if (n != null) {
            if (min != null && n < min) n = min;
            if (max != null && n > max) n = max;
          }
          const nextText = n === parsed
            ? formatMoneyInputDraft(raw, min < 0, decimals)
            : format(n);
          selection.current = moneyInputCaret(e.target.value, nextText, e.target.selectionStart ?? e.target.value.length);
          setText(nextText);
          setNumericValue(n);
          onChange?.(n);
        }}
        onBlur={(e) => {
          editing.current = false;
          if (invalid.current) {
            // Restore the value from before this edit and never commit malformed
            // text as null/zero through the parent's blur handler.
            setText(format(focusValue.current));
            setNumericValue(focusValue.current);
            onChange?.(focusValue.current);
            invalid.current = false;
            e.currentTarget.setCustomValidity("");
            return;
          }
          setText(format(numericValue));
          onBlur?.(e);
        }}
        {...props}
      />
    );
    return <>
      {name && <input type="hidden" name={name} value={numericValue ?? ""} disabled={disabled} form={form} />}
      {suffix ? <span className="relative block">
        {input}
        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">{suffix}</span>
      </span> : input}
    </>;
  }
);
MoneyInput.displayName = "MoneyInput";

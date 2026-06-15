"use client";

import { cn } from "@/lib/utils";

/** Công tắc bật/tắt (theo prototype .tog 38×21, teal khi bật). */
export function Toggle({
  checked, onChange, disabled, "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "relative w-[38px] h-[21px] rounded-full shrink-0 transition-colors disabled:opacity-50",
        checked ? "bg-primary-600" : "bg-border"
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] w-[15px] h-[15px] rounded-full bg-white transition-[left] shadow-sm",
          checked ? "left-[20px]" : "left-[3px]"
        )}
      />
    </button>
  );
}

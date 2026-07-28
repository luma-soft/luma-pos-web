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
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-50 lg:h-[21px] lg:w-[38px]"
    >
      <span
        className={cn(
          "relative h-[21px] w-[38px] rounded-full transition-colors",
          checked ? "bg-primary-600" : "bg-border"
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-[15px] w-[15px] rounded-full bg-white shadow-sm transition-[left]",
            checked ? "left-[20px]" : "left-[3px]"
          )}
        />
      </span>
    </button>
  );
}

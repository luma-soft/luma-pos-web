"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberInput } from "./number-input";

export interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  disabled?: boolean;
  readOnly?: boolean;
  size?: "sm" | "default";
  className?: string;
  inputClassName?: string;
  touchTargets?: boolean;
  decrementLabel?: string;
  inputLabel?: string;
  incrementLabel?: string;
}

export function normalizeQuantity(
  value: number,
  {
    min = 0,
    max,
    decimals = 4,
  }: Pick<QuantityInputProps, "min" | "max" | "decimals"> = {},
) {
  const finiteValue = Number.isFinite(value) ? value : min;
  const upperBound =
    max != null && max >= min ? max : Number.POSITIVE_INFINITY;
  const clamped = Math.min(upperBound, Math.max(min, finiteValue));
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

export function stepQuantity(
  value: number,
  direction: -1 | 1,
  {
    min = 0,
    max,
    step = 1,
    decimals = 4,
  }: Pick<
    QuantityInputProps,
    "min" | "max" | "step" | "decimals"
  > = {},
) {
  const tolerance = 1e-9;
  const stepIndex =
    direction === 1
      ? Math.floor(value / step + tolerance) + 1
      : Math.ceil(value / step - tolerance) - 1;
  const candidate = stepIndex * step;
  if (candidate < min - tolerance) return value;
  if (max != null && max >= min && candidate > max + tolerance) return value;
  return normalizeQuantity(candidate, {
    min,
    max,
    decimals,
  });
}

export const QuantityInput = React.forwardRef<HTMLInputElement, QuantityInputProps>(
  (
    {
      value,
      onChange,
      min = 0,
      max,
      step = 1,
      decimals = 4,
      disabled = false,
      readOnly = false,
      size = "default",
      className,
      inputClassName,
      touchTargets = false,
      decrementLabel = "Decrease quantity",
      inputLabel = "Quantity",
      incrementLabel = "Increase quantity",
    },
    ref,
  ) => {
    const locked = disabled || readOnly;
    const upperBound = max != null && max >= min ? max : undefined;
    const update = (nextValue: number) =>
      onChange(normalizeQuantity(nextValue, { min, max: upperBound, decimals }));
    const decreasedValue = stepQuantity(value, -1, {
      min,
      max: upperBound,
      step,
      decimals,
    });
    const increasedValue = stepQuantity(value, 1, {
      min,
      max: upperBound,
      step,
      decimals,
    });

    return (
      <div
        className={cn(
          "grid shrink-0 grid-cols-[44px_minmax(44px,1fr)_44px] overflow-hidden rounded-lg border border-border bg-surface transition-[border-color] duration-150 focus-within:border-primary-600 lg:grid-cols-[32px_minmax(44px,1fr)_32px]",
          size === "sm" ? "h-11 lg:h-8" : "h-11 lg:h-10",
          touchTargets && "min-h-11 grid-cols-[44px_minmax(44px,1fr)_44px]",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <button
          type="button"
          disabled={locked || decreasedValue === value}
          onClick={() => onChange(decreasedValue)}
          aria-label={decrementLabel}
          className="grid h-full place-items-center text-slate-500 transition-colors hover:bg-surface-2 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <NumberInput
          ref={ref}
          value={value}
          onChange={(nextValue) => update(nextValue ?? min)}
          min={min}
          max={upperBound}
          decimals={decimals}
          thousandSeparator={false}
          size={size}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={inputLabel}
          className={cn(
            "h-full rounded-none border-y-0 px-1 text-center focus:ring-0",
            inputClassName,
          )}
        />
        <button
          type="button"
          disabled={locked || increasedValue === value}
          onClick={() => onChange(increasedValue)}
          aria-label={incrementLabel}
          className="grid h-full place-items-center text-slate-500 transition-colors hover:bg-surface-2 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  },
);
QuantityInput.displayName = "QuantityInput";

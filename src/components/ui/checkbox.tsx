"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Luma visuals with native, non-visible form and keyboard semantics. */
export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  ({ className, ...props }, ref) => (
    <span className={cn("relative inline-flex size-4 shrink-0 align-middle", className)}>
      <input
        {...props}
        ref={ref}
        type="checkbox"
        className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span aria-hidden="true" className="grid size-full place-items-center rounded border border-slate-300 bg-surface text-white transition-colors peer-checked:border-primary-600 peer-checked:bg-primary-600 peer-indeterminate:border-primary-600 peer-indeterminate:bg-primary-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-600 peer-disabled:opacity-50 peer-checked:[&>.check]:block peer-indeterminate:[&>.check]:hidden peer-indeterminate:[&>.mixed]:block">
        <Check className="check hidden size-3" strokeWidth={3} />
        <Minus className="mixed hidden size-3" strokeWidth={3} />
      </span>
    </span>
  ),
);
Checkbox.displayName = "Checkbox";

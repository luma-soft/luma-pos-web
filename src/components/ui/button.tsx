"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { resolveText, type TxProps } from "./_tx";
import { buttonVariants, type ButtonVariantProps } from "./button-variants";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    ButtonVariantProps,
    TxProps {
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, loading, disabled, tx, txOptions, text, children, ...props }, ref) => {
    const t = useTranslations();
    const content = resolveText({ tx, txOptions, text, children }, t);

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size, block, className }))}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-1 h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {content}
      </button>
    );
  }
);
Button.displayName = "Button";

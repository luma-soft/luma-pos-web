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
  loadingMode?: "inline" | "replace";
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, loading, loadingMode = "inline", disabled, tx, txOptions, text, children, ...props }, ref) => {
    const t = useTranslations();
    const content = resolveText({ tx, txOptions, text, children }, t);
    const replaceContent = loadingMode === "replace";

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          buttonVariants({ variant, size, block, className }),
          replaceContent && "relative",
        )}
        {...props}
      >
        {replaceContent ? (
          <span className={cn("inline-flex items-center gap-[inherit]", loading && "opacity-0")}>
            {content}
          </span>
        ) : content}
        {loading && (
          <svg
            aria-hidden="true"
            className={cn(
              "h-4 w-4 animate-spin",
              replaceContent
                ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                : "-ml-1 mr-1",
            )}
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
      </button>
    );
  }
);
Button.displayName = "Button";

"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TxValues } from "./_tx";

const inputVariants = cva(
  "flex w-full rounded-lg border bg-transparent px-3 text-sm transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "h-8 px-2 text-xs",
        default: "h-10",
        lg: "h-12 text-base",
      },
      variant: {
        default: "border-border",
        error: "border-red-500 focus:ring-red-500",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** i18n key for placeholder */
  placeholderTx?: string;
  /** ICU values for `placeholderTx` */
  placeholderTxOptions?: TxValues;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, variant, leftIcon, rightIcon, placeholder, placeholderTx, placeholderTxOptions, ...props }, ref) => {
    const t = useTranslations();
    const finalPlaceholder = placeholderTx ? t(placeholderTx, placeholderTxOptions) : placeholder;

    if (leftIcon || rightIcon) {
      return (
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none [&_svg]:size-4">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            placeholder={finalPlaceholder}
            className={cn(
              inputVariants({ size, variant }),
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 [&_svg]:size-4">
              {rightIcon}
            </div>
          )}
        </div>
      );
    }
    return (
      <input
        ref={ref}
        placeholder={finalPlaceholder}
        className={cn(inputVariants({ size, variant }), className)}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

// Textarea
const textareaVariants = cva(
  "flex w-full rounded-lg border bg-transparent px-3 py-2 text-sm transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-border",
        error: "border-red-500 focus:ring-red-500",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  placeholderTx?: string;
  placeholderTxOptions?: TxValues;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, rows = 3, placeholder, placeholderTx, placeholderTxOptions, ...props }, ref) => {
    const t = useTranslations();
    const finalPlaceholder = placeholderTx ? t(placeholderTx, placeholderTxOptions) : placeholder;

    return (
      <textarea
        ref={ref}
        rows={rows}
        placeholder={finalPlaceholder}
        className={cn(textareaVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

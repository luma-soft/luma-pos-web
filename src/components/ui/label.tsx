"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { resolveText, type TxProps, type TxValues } from "./_tx";
import { Text } from "./text";

export interface LabelProps
  extends Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "children">,
    TxProps {
  required?: boolean;
  children?: React.ReactNode;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, tx, txOptions, text, children, ...props }, ref) => {
    const t = useTranslations();
    const content = resolveText({ tx, txOptions, text, children }, t);

    return (
      <label
        ref={ref}
        className={cn(
          "block text-sm font-medium text-slate-900 dark:text-slate-100",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className
        )}
        {...props}
      >
        {content}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
    );
  }
);
Label.displayName = "Label";

// Field wrapper: label + input + error/hint with optional i18n
export interface FieldProps {
  label?: React.ReactNode;
  labelTx?: string;
  labelTxOptions?: TxValues;
  error?: React.ReactNode;
  errorTx?: string;
  errorTxOptions?: TxValues;
  hint?: React.ReactNode;
  hintTx?: string;
  hintTxOptions?: TxValues;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label, labelTx, labelTxOptions,
  error, errorTx, errorTxOptions,
  hint, hintTx, hintTxOptions,
  required, children, className,
}: FieldProps) {
  const t = useTranslations();

  const labelContent = labelTx ? t(labelTx, labelTxOptions) : label;
  const errorContent = errorTx ? t(errorTx, errorTxOptions) : error;
  const hintContent = hintTx ? t(hintTx, hintTxOptions) : hint;

  return (
    <div className={cn("space-y-1.5 [&>div]:w-full", className)}>
      {labelContent && <Label required={required}>{labelContent}</Label>}
      {children}
      {hintContent && !errorContent && (
        <Text as="p" variant="muted" size="xs" text={hintContent} />
      )}
      {errorContent && (
        <Text as="p" variant="destructive" size="xs" text={errorContent} />
      )}
    </div>
  );
}

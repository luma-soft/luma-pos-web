"use client";

import * as React from "react";
import {
  FormProvider,
  Controller,
  useFormContext,
  type FieldValues,
  type UseFormReturn,
  type FieldPath,
  type ControllerRenderProps,
  type FieldError,
  type SubmitErrorHandler,
} from "react-hook-form";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Label } from "./label";
import type { TxValues } from "./_tx";

// ============= Form =============

export interface FormProps<TIn extends FieldValues, TOut extends FieldValues = TIn>
  extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  form: UseFormReturn<TIn, unknown, TOut>;
  onSubmit: (values: TOut) => void | Promise<void>;
  onInvalidSubmit?: SubmitErrorHandler<TIn>;
}

export function Form<TIn extends FieldValues, TOut extends FieldValues = TIn>({
  form, onSubmit, onInvalidSubmit, className, children, ...props
}: FormProps<TIn, TOut>) {
  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalidSubmit)}
        className={cn("space-y-4", className)}
        noValidate
        {...props}
      >
        {children}
      </form>
    </FormProvider>
  );
}

// ============= FormField =============

interface FieldContextValue {
  name: string;
  id: string;
  error?: FieldError;
}
const FieldCtx = React.createContext<FieldContextValue | null>(null);

export function useFormField() {
  const ctx = React.useContext(FieldCtx);
  if (!ctx) throw new Error("useFormField must be used within <FormField>");
  return ctx;
}

export interface FormFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  name: N;
  label?: React.ReactNode;
  labelTx?: string;
  labelTxOptions?: TxValues;
  hint?: React.ReactNode;
  hintTx?: string;
  hintTxOptions?: TxValues;
  required?: boolean;
  className?: string;
  /** Render prop receives RHF field props ({ value, onChange, onBlur, name, ref }). */
  children: (field: ControllerRenderProps<T, N> & { id: string; "aria-invalid": boolean }) => React.ReactNode;
}

export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  name, label, labelTx, labelTxOptions, hint, hintTx, hintTxOptions,
  required, className, children,
}: FormFieldProps<T, N>) {
  const t = useTranslations();
  const { control, formState } = useFormContext<T>();
  const id = React.useId();
  const error = formState.errors[name] as FieldError | undefined;

  const labelContent = labelTx ? t(labelTx, labelTxOptions) : label;
  const hintContent = hintTx ? t(hintTx, hintTxOptions) : hint;

  // Translate error message if it looks like an i18n key (contains dot, no spaces)
  const rawError = error?.message;
  const errorContent = rawError
    ? (rawError.includes(".") && !rawError.includes(" "))
      ? safeT(t, rawError)
      : rawError
    : undefined;

  return (
    <FieldCtx.Provider value={{ name, id, error }}>
      <div className={cn("space-y-1.5", className)}>
        {labelContent && (
          <Label htmlFor={id} required={required}>{labelContent}</Label>
        )}
        <Controller
          control={control}
          name={name}
          render={({ field }) =>
            children({
              ...field,
              id,
              "aria-invalid": !!error,
            }) as React.ReactElement
          }
        />
        {hintContent && !errorContent && (
          <p className="text-xs text-slate-500">{hintContent}</p>
        )}
        {errorContent && (
          <p className="text-xs text-red-600">{errorContent}</p>
        )}
      </div>
    </FieldCtx.Provider>
  );
}

function safeT(t: ReturnType<typeof useTranslations>, key: string): string {
  try { return t(key); } catch { return key; }
}

"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Local "YYYY-MM-DDTHH:mm" for a date, as used by datetime-local inputs. */
export function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts a chosen local value to the ISO payload; empty means "now". */
export function documentTimePayload(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : undefined;
}

/** Same as documentTimePayload for actions typed with parsed (Date) input. */
export function documentTimeDate(value: string | null | undefined) {
  return value ? new Date(value) : undefined;
}

/**
 * Optional backdated document time. Empty shows "Now" and keeps the server's
 * current time; future days are disabled.
 */
export function DocumentTimeField({
  label,
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const t = useTranslations("documentTime");
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="relative">
        <DateInput
          type="datetime-local"
          value={value}
          max={toLocalDateTimeValue(new Date())}
          placeholder={placeholder ?? t("now")}
          aria-label={label}
          wideTrailingInset={Boolean(value)}
          onChange={(event) => onChange(event.target.value)}
          className={cn("min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm", inputClassName)}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("reset")}
            title={t("reset")}
            className="absolute inset-y-0 right-11 grid w-9 place-items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

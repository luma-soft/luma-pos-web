"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatCurrency } from "@/lib/utils";

export function ProfitVisibility({
  label,
  value,
  caption,
  className,
}: {
  label: string;
  value: number;
  caption?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("customerProfit");
  const [visible, setVisible] = useState(false);

  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <div>{label}</div>
        {caption && <div className="mt-0.5 text-xs font-normal text-slate-500">{caption}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn(
          "font-semibold tabular-nums",
          value > 0 ? "text-ok" : value < 0 ? "text-er" : "text-slate-500",
        )} aria-live="polite">
          {visible ? formatCurrency(value) : "••••••"}
        </span>
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t("hide") : t("show")}
          title={visible ? t("hide") : t("show")}
          className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils";

export function MobileProfitMetricValue({ value }: { value: number }) {
  const t = useTranslations("customerProfit");
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative block min-w-0">
      <span className="block truncate pr-8" aria-live="polite">
        {visible ? formatCurrency(value) : "••••••"}
      </span>
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? t("hide") : t("show")}
        title={visible ? t("hide") : t("show")}
        className="absolute -right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-slate-500 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </button>
    </span>
  );
}

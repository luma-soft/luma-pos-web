"use client";

import { useState } from "react";
import { Eye, EyeOff, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { MobileMetricTileContent, mobileMetricTileClass } from "@/components/mobile-ui";

/**
 * Gross-profit summary tile. Like the native DashboardSummaryView, the whole
 * tile toggles visibility and the amount and margin stay masked by default.
 */
export function MobileProfitMetricTile({
  label,
  value,
  margin,
  hiddenMargin,
}: {
  label: string;
  value: string;
  margin: string;
  hiddenMargin: string;
}) {
  const t = useTranslations("customerProfit");
  const [visible, setVisible] = useState(false);
  const Indicator = visible ? Eye : EyeOff;

  return (
    <button
      type="button"
      onClick={() => setVisible((current) => !current)}
      aria-label={visible ? t("hide") : t("show")}
      aria-pressed={visible}
      className={mobileMetricTileClass}
    >
      <MobileMetricTileContent
        icon={TrendingUp}
        tint="green"
        label={label}
        value={<span aria-live="polite">{visible ? value : "••••••"}</span>}
        detail={visible ? margin : hiddenMargin}
        accessory={<Indicator className="size-[18px] shrink-0 text-ios-label-secondary" aria-hidden="true" />}
      />
    </button>
  );
}

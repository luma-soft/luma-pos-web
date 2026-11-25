import { useLocale, useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils";

/** Locale-aware number/money/percent formatters for report screens (server or client). */
export function useReportFormat() {
  const t = useTranslations("reports.d");
  const locale = useLocale() === "en" ? "en-US" : "vi-VN";
  const number = (value: number, digits = 1) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const money = (value: number) => {
    const abs = Math.abs(value);
    const sign = value < 0 ? "−" : "";
    if (abs >= 1_000_000_000) return sign + t("units.billion", { value: number(abs / 1_000_000_000) });
    if (abs >= 1_000_000) return sign + t("units.million", { value: number(abs / 1_000_000) });
    if (abs >= 1_000) return sign + t("units.thousand", { value: number(Math.round(abs / 1_000), 0) });
    return formatCurrency(value);
  };
  const percent = (value: number) => `${number(value)}%`;
  /** yyyy-MM-dd → dd/MM (short) or dd/MM/yyyy. */
  const date = (key: string, withYear = false) => {
    const [year, month, day] = key.split("-");
    return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
  };
  return { t, locale, number, money, percent, date, currency: formatCurrency };
}

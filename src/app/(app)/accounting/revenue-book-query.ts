import type { ReportPeriod } from "../reports/report-period-filter";

/**
 * Revenue book period and list filters, shared by the accounting page and the
 * phone load-more action so extra pages use the same range and filters.
 */
export const ACCOUNTING_PERIODS: readonly ReportPeriod[] = ["today", "7d", "30d", "90d", "this_month", "last_month", "this_year", "custom"];

export type AccountingSearchParams = Record<string, string | undefined>;

export function revenueBookQuery(params: AccountingSearchParams) {
  const period = ACCOUNTING_PERIODS.includes(params.period as ReportPeriod) ? params.period as ReportPeriod : "this_month";
  const dateRange = resolveDateRange(period, params.from, params.to);
  return {
    period,
    dateRange,
    filters: {
      from: dateRange.from,
      to: dateRange.toExclusive,
      q: params.q,
      document: (params.document === "sale" || params.document === "return" ? params.document : "all") as "sale" | "return" | "all",
      einvoice: (params.einvoice === "issued" || params.einvoice === "none" ? params.einvoice : "all") as "issued" | "none" | "all",
    },
  };
}

export function resolveDateRange(period: ReportPeriod, fromParam?: string, toParam?: string) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  let from = new Date(today.getFullYear(), today.getMonth(), 1);
  let toExclusive = tomorrow;
  if (period === "today") from = today;
  else if (period === "7d") from = addDays(today, -6);
  else if (period === "30d") from = addDays(today, -29);
  else if (period === "90d") from = addDays(today, -89);
  else if (period === "last_month") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); toExclusive = new Date(today.getFullYear(), today.getMonth(), 1); }
  else if (period === "this_year") from = new Date(today.getFullYear(), 0, 1);
  else if (period === "custom") {
    const customFrom = parseDate(fromParam); const customTo = parseDate(toParam);
    if (customFrom && customTo && customFrom <= customTo) { from = customFrom; toExclusive = addDays(customTo, 1); }
  }
  const toInclusive = addDays(toExclusive, -1);
  return { from, toExclusive, fromValue: dateInputValue(from), toValue: dateInputValue(toInclusive) };
}
function parseDate(value?: string) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function startOfDay(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, days: number) { const date = new Date(value); date.setDate(date.getDate() + days); return date; }
function dateInputValue(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

import { BUSINESS_TIME_ZONE, businessDateKey } from "@/lib/dates/business-date";

export const REPORT_PERIODS = [
  "today",
  "week",
  "7d",
  "30d",
  "90d",
  "this_month",
  "last_month",
  "this_year",
  "custom",
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** How a report's time series is grouped for charts and exports. */
export type ReportGranularity = "day" | "week" | "month";

/** Vietnam has no daylight saving time, so a fixed offset is exact. */
const BUSINESS_UTC_OFFSET = "+07:00";

export { BUSINESS_TIME_ZONE };

/** SQL fragment text: a timestamptz column rendered as a business-day key (yyyy-MM-dd). */
export const BUSINESS_TIME_ZONE_SQL = `'${BUSINESS_TIME_ZONE}'`;

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === "string" && (REPORT_PERIODS as readonly string[]).includes(value);
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Calendar arithmetic on yyyy-MM-dd keys, independent of the server time zone. */
export function addDaysToKey(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The instant a business day starts in Vietnam. */
export function businessDayStart(key: string) {
  return new Date(`${key}T00:00:00${BUSINESS_UTC_OFFSET}`);
}

/** Business-day key of an instant. */
export function businessDayKeyOf(value: Date) {
  return businessDateKey(value);
}

export function daysBetweenKeys(fromKey: string, toKeyExclusive: string) {
  return Math.round((Date.parse(`${toKeyExclusive}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

/** Every business-day key in [fromKey, toKeyExclusive). */
export function dayKeysBetween(fromKey: string, toKeyExclusive: string) {
  const keys: string[] = [];
  for (let key = fromKey; key < toKeyExclusive; key = addDaysToKey(key, 1)) keys.push(key);
  return keys;
}

export function granularityForDays(days: number): ReportGranularity {
  if (days <= 62) return "day";
  if (days <= 366) return "week";
  return "month";
}

export type ReportRange = {
  period: ReportPeriod;
  /** First business day, yyyy-MM-dd. */
  fromValue: string;
  /** Last business day (inclusive), yyyy-MM-dd. */
  toValue: string;
  from: Date;
  toExclusive: Date;
  rangeDays: number;
  granularity: ReportGranularity;
};

/**
 * Resolve a report period to business-day bounds in Vietnam time. "week" starts
 * on Monday (iOS ReportsView); the rolling presets include today.
 */
export function resolveReportRange(period: ReportPeriod, fromParam?: string | null, toParam?: string | null, now = new Date()): ReportRange {
  const today = businessDateKey(now);
  const tomorrow = addDaysToKey(today, 1);
  const [year, month] = today.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  let fromKey = monthStart;
  let toKey = tomorrow;
  if (period === "today") fromKey = today;
  else if (period === "week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    fromKey = addDaysToKey(today, -((weekday + 6) % 7));
  } else if (period === "7d") fromKey = addDaysToKey(today, -6);
  else if (period === "30d") fromKey = addDaysToKey(today, -29);
  else if (period === "90d") fromKey = addDaysToKey(today, -89);
  else if (period === "last_month") {
    const previous = month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`;
    fromKey = previous;
    toKey = monthStart;
  } else if (period === "this_year") fromKey = `${year}-01-01`;
  else if (period === "custom" && isDateKey(fromParam) && isDateKey(toParam) && fromParam <= toParam) {
    fromKey = fromParam;
    toKey = addDaysToKey(toParam, 1);
  }
  const rangeDays = Math.max(1, daysBetweenKeys(fromKey, toKey));
  return {
    period,
    fromValue: fromKey,
    toValue: addDaysToKey(toKey, -1),
    from: businessDayStart(fromKey),
    toExclusive: businessDayStart(toKey),
    rangeDays,
    granularity: granularityForDays(rangeDays),
  };
}

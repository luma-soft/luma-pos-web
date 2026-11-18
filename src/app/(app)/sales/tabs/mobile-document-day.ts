/**
 * Mobile invoice day groups mirror NativeInvoiceHistoryDayGroup. Only the
 * first row of each consecutive date group receives a heading; page-level
 * pagination, sort and server filtering remain untouched.
 */
export function mobileDocumentDay(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function mobileDocumentDayHeadings<T extends { id: string }>(
  rows: readonly T[],
  dateFor: (row: T) => Date | string | null | undefined,
): Map<string, string> {
  const headings = new Map<string, string>();
  let previous = "";
  for (const row of rows) {
    const current = mobileDocumentDay(dateFor(row));
    if (current && current !== previous) headings.set(row.id, current);
    previous = current;
  }
  return headings;
}

export type MobileDocumentDayGroup = { title: string; summary: string };

export type MobileDocumentDayGroupCopy = {
  locale: string;
  today: (date: string) => string;
  yesterday: (date: string) => string;
  tomorrow?: (date: string) => string;
  summary: (count: number, total: string) => string;
};

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** NativeInvoiceHistoryDayGroup.compactTotal: "34,91 triệu", "300 nghìn", "950 ₫". */
export function mobileDocumentCompactTotal(total: number, locale: string): string {
  const vietnamese = !locale.startsWith("en");
  const numberLocale = vietnamese ? "vi-VN" : "en-US";
  const [divisor, digits, unit] = total >= 1_000_000
    ? [1_000_000, 2, vietnamese ? "triệu" : "million"]
    : total >= 1_000
      ? [1_000, 1, vietnamese ? "nghìn" : "thousand"]
      : [1, 0, "₫"];
  const value = new Intl.NumberFormat(numberLocale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
    useGrouping: divisor === 1,
  }).format(total / divisor);
  return `${value} ${unit}`;
}

/**
 * Day sections for the loaded page, keyed by the first row of each day, with the
 * native title ("Today · dd/MM/yyyy") and the day's document count and total.
 */
export function mobileDocumentDayGroups<T extends { id: string }>(
  rows: readonly T[],
  dateFor: (row: T) => Date | string | null | undefined,
  totalFor: (row: T) => number,
  copy: MobileDocumentDayGroupCopy,
  now: Date = new Date(),
): Map<string, MobileDocumentDayGroup> {
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const tomorrow = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const days: Array<{ firstId: string; key: string; date: string; count: number; total: number }> = [];
  for (const row of rows) {
    const raw = dateFor(row);
    const date = raw ? (raw instanceof Date ? raw : new Date(raw)) : null;
    const valid = date && Number.isFinite(date.getTime()) ? date : null;
    const key = valid ? localDayKey(valid) : "";
    const last = days[days.length - 1];
    if (last && last.key === key) {
      last.count += 1;
      last.total += totalFor(row);
    } else {
      days.push({ firstId: row.id, key, date: valid ? mobileDocumentDay(valid) : "", count: 1, total: totalFor(row) });
    }
  }
  const groups = new Map<string, MobileDocumentDayGroup>();
  for (const day of days) {
    if (!day.key) continue;
    const title = day.key === today ? copy.today(day.date)
      : day.key === yesterday ? copy.yesterday(day.date)
      : day.key === tomorrow && copy.tomorrow ? copy.tomorrow(day.date)
      : day.date;
    groups.set(day.firstId, { title, summary: copy.summary(day.count, mobileDocumentCompactTotal(day.total, copy.locale)) });
  }
  return groups;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * DateFormatter(dateStyle: .medium, timeStyle: .short) as iOS renders it:
 * "20:14 ngày 17 thg 11, 2026" / "Nov 17, 2026 at 8:14 PM". Built from date
 * parts instead of Intl so server (Node ICU) and Safari produce identical text
 * and hydration never diverges.
 */
export function mobileDocumentTimestamp(value: Date | string | null | undefined, locale: string): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  if (locale.startsWith("en")) {
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${EN_MONTHS[month]} ${day}, ${year} at ${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
  }
  return `${String(hours).padStart(2, "0")}:${minutes} ngày ${day} thg ${month + 1}, ${year}`;
}

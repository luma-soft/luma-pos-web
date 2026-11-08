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

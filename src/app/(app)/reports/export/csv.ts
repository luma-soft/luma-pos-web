function cell(value: string | number | null | undefined) {
  if (value == null) return "";
  const text = String(value);
  // Neutralise spreadsheet formulas in user-entered text (CSV injection).
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV with a UTF-8 BOM so Excel opens Vietnamese text correctly. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]) {
  return "﻿" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function parseMoneyInput(text: string, allowNegative = false, decimals = 0): number | null {
  const normalized = decimals > 0
    ? text.replace(/[^\d,]/g, "").replace(",", ".")
    : text.replace(/[^\d]/g, "");
  if (!normalized || !/^\d*(\.\d*)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const sign = allowNegative && text.trim().startsWith("-") ? -1 : 1;
  return sign * value;
}

export function formatMoneyInput(value: number | null, decimals = 0): string {
  return value == null ? "" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals > 0 ? decimals : 3 }).format(value);
}

/** Nonempty malformed input is not an intentional request to clear a price. */
export function readMoneyInput(text: string, allowNegative = false, decimals = 0) {
  const value = parseMoneyInput(text, allowNegative, decimals);
  return value == null && text.trim() !== "" ? { valid: false as const } : { valid: true as const, value };
}

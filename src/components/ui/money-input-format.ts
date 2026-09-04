/** Accept Vietnamese display values and canonical decimal amounts pasted from data. */
function normalizeMoneyInput(text: string, allowNegative: boolean, decimals: number): string | null {
  let raw = text.trim().replace(/\s/g, "").replace(/(?:VND|đ|₫)$/i, "");
  const negative = raw.startsWith("-");
  if (negative && !allowNegative) return null;
  raw = raw.replace(/^[+-]/, "");
  if (!raw) return null;
  let normalized: string;
  if (raw.includes(",") && decimals > 0) {
    const [whole, fraction, extra] = raw.split(",");
    if (extra !== undefined || !/^\d*$/.test(fraction) || fraction.length > decimals) return null;
    if (!/^\d+$/.test(whole) && !/^\d{1,3}(?:\.\d{3})+$/.test(whole) && whole !== "") return null;
    normalized = `${whole.replace(/\./g, "") || "0"}.${fraction}`;
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  } else if (decimals > 0 && /^\d+\.\d*$/.test(raw) && raw.split(".")[1].length <= decimals) {
    normalized = raw;
  } else if (decimals === 0 && /^\d{1,3}(?:,\d{3})+$/.test(raw)) {
    normalized = raw.replace(/,/g, "");
  } else if (/^\d+$/.test(raw)) {
    normalized = raw;
  } else return null;
  return `${negative ? "-" : ""}${normalized}`;
}

export function parseMoneyInput(text: string, allowNegative = false, decimals = 0): number | null {
  const normalized = normalizeMoneyInput(text, allowNegative, decimals);
  if (normalized == null) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Existing grouping can be temporarily uneven after inserting/deleting a digit. */
export function moneyInputEditText(raw: string, previous: string, inputType: string, data: string | null, decimals = 0): string {
  const keyboardEdit = inputType.startsWith("delete") || (inputType === "insertText" && data?.length === 1);
  if (!keyboardEdit || !previous.includes(".")) return raw;
  if (decimals > 0 && data === "." && raw.endsWith(".") && !raw.includes(",")) {
    return `${raw.slice(0, -1).replace(/\./g, "")},`;
  }
  return raw.replace(/\./g, "");
}

export function formatMoneyInput(value: number | null, decimals = 0): string {
  return value == null ? "" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals > 0 ? decimals : 3 }).format(value);
}

/** Group the integer part without dropping a trailing comma or fractional zero. */
export function formatMoneyInputDraft(text: string, allowNegative = false, decimals = 0): string {
  if (allowNegative && text.trim() === "-") return "-";
  const value = parseMoneyInput(text, allowNegative, decimals);
  if (value == null) return "";
  if (decimals <= 0) return formatMoneyInput(value);
  const [whole, fraction] = normalizeMoneyInput(text, allowNegative, decimals)!.replace(/^-/, "").split(".");
  const sign = allowNegative && text.trim().startsWith("-") ? "-" : "";
  const integer = (whole || "0").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${integer}${fraction === undefined ? "" : `,${fraction}`}`;
}

/** Keep the logical edit position when thousands separators move. */
export function moneyInputCaret(raw: string, formatted: string, position: number): number {
  const source = formatted.includes(",") && !raw.includes(",") && raw.split(".").length === 2
    ? raw.replace(".", ",") : raw;
  const count = source.slice(0, position).replace(/[^\d,-]/g, "").length;
  if (count === 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index++) {
    if (/[\d,-]/.test(formatted[index]) && ++seen === count) return index + 1;
  }
  return formatted.length;
}

/** Nonempty malformed input is not an intentional request to clear a price. */
export function readMoneyInput(text: string, allowNegative = false, decimals = 0) {
  const value = parseMoneyInput(text, allowNegative, decimals);
  return value == null && text.trim() !== "" ? { valid: false as const } : { valid: true as const, value };
}

/** Decimal fields accept either decimal mark; integer fields retain vi-VN grouping. */
export function parseNumberInput(
  input: string,
  { thousandSeparator = true, decimals = 0 }: { thousandSeparator?: boolean; decimals?: number } = {},
): number | null {
  let text = input.trim().replace(/\s/g, "");
  if (!/^-?[\d.,]*$/.test(text)) return null;
  if (decimals <= 0 && thousandSeparator) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",") && text.includes(".")) {
    const decimalMark = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const groupingMark = decimalMark === "," ? "." : ",";
    text = text.split(groupingMark).join("").replace(decimalMark, ".");
  } else {
    text = text.replace(",", ".");
  }
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

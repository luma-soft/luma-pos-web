import { normalizeSearch, matchesSearchTokens } from "@/lib/normalize";

/** Bulk price editing for a variant group's SKU rows (web and iOS share these rules). */
export type VariantBulkPriceField = "costPrice" | "retailPrice";
export type VariantBulkPriceMode = "set" | "percent" | "amount";
export type VariantRowStatusFilter = "all" | "new" | "existing";

/**
 * "set" replaces the price, "percent" and "amount" adjust it (negative values lower it).
 * Results are whole đồng and never negative.
 */
export function bulkAdjustedPrice(current: number | string | null | undefined, mode: VariantBulkPriceMode, value: number) {
  const base = Number(current ?? 0);
  const safeBase = Number.isFinite(base) ? base : 0;
  const next = mode === "set" ? value : mode === "percent" ? safeBase * (1 + value / 100) : safeBase + value;
  return Math.max(0, Math.round(next));
}

export function isValidBulkPriceInput(mode: VariantBulkPriceMode, value: number) {
  if (!Number.isFinite(value)) return false;
  if (mode === "set") return value >= 0;
  if (mode === "percent") return value > -100 && value !== 0;
  return value !== 0;
}

/** Search matches the option label or SKU; status separates saved SKUs from new combinations. */
export function variantRowMatches(
  row: { variantName: string; sku?: string | null; persisted: boolean },
  query: string,
  status: VariantRowStatusFilter,
) {
  if (status === "new" && row.persisted) return false;
  if (status === "existing" && !row.persisted) return false;
  if (!normalizeSearch(query)) return true;
  return matchesSearchTokens(`${row.variantName} ${row.sku ?? ""}`, query);
}

export type ProductStockHistoryLoadState = "loading" | "ready" | "offline" | "error";
export type ProductStockHistoryPageState = {
  scopeId: string;
  productId: string;
  page: number;
  rows: readonly unknown[];
};

/** Keep an uncached offline page distinct from an authoritative empty history. */
export function resolveProductStockHistoryPanelState(
  history: ProductStockHistoryPageState | null,
  expected: { scopeId?: string; productId: string; page: number },
  loadState: ProductStockHistoryLoadState,
): "ready" | "empty" | "offline-unavailable" | "error" | "loading" {
  const matches = history !== null
    && history.scopeId === expected.scopeId
    && history.productId === expected.productId
    && history.page === expected.page;
  if (matches) return history.rows.length === 0 ? "empty" : "ready";
  if (loadState === "offline") return "offline-unavailable";
  if (loadState === "error") return "error";
  return "loading";
}

/**
 * Document queries append this marker to a line's product name when the
 * product was soft-deleted (`lifecycleStatus = 'deleted'`); the stored
 * document name stays unchanged.
 */
export const DELETED_PRODUCT_MARKER = "{DEL}";

export function isDeletedProductName(name: string | null | undefined) {
  return typeof name === "string" && name.includes(DELETED_PRODUCT_MARKER);
}

export const PRODUCT_SEARCH_DEBOUNCE_MS = 250;

export function shouldSelectProductSearchItem({
  selected,
  disabled,
}: {
  selected: boolean;
  disabled: boolean;
}) {
  return !selected && !disabled;
}

export function setSelectedProductQuantity<T>(
  rows: readonly T[],
  quantity: number,
  isTarget: (row: T, index: number) => boolean,
  update: (row: T, quantity: number) => T,
): T[] {
  if (quantity <= 0) return rows.filter((row, index) => !isTarget(row, index));
  return rows.map((row, index) => isTarget(row, index) ? update(row, quantity) : row);
}

export function nextProductSearchActiveIndex(
  current: number,
  itemCount: number,
  direction: "next" | "previous",
) {
  if (itemCount <= 0) return -1;
  if (direction === "next") return current >= itemCount - 1 ? 0 : current + 1;
  return current <= 0 ? itemCount - 1 : current - 1;
}

/** Prevents an older async search from replacing a newer query's results. */
export class ProductSearchRequestGate {
  #current = 0;

  next() {
    this.#current += 1;
    return this.#current;
  }

  isLatest(requestId: number) {
    return requestId === this.#current;
  }
}

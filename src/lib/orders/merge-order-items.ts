type MergeableOrderItem = {
  id: string;
  productId: string;
  productName: string;
  unitName: string;
  unitMultiplier: string | number;
  sourceSku: string | null;
  priceBookId: string | null;
  priceBookName: string | null;
  preDiscountUnitPrice: string | number | null;
  lineDiscountMode: string | null;
  lineDiscountValue: string | number | null;
  quantity: string | number;
  unitPrice: string | number;
  discount: string | number;
  total: string | number;
  note: string | null;
  taxActivityId: string | null;
  taxActivityName: string | null;
  vatRevenueRate: string | number | null;
  pitRevenueRate: string | number | null;
  lineOrder: number;
};

type MergedItem<T extends MergeableOrderItem> = {
  item: Omit<T, "quantity" | "discount" | "total" | "lineOrder"> & {
    quantity: string;
    discount: string;
    total: string;
    lineOrder: number;
  };
  sourceItemIds: string[];
};

type ItemGroup<T extends MergeableOrderItem> = {
  item: T;
  sourceItemIds: string[];
  quantity: number;
  discount: number;
  total: number;
};

function decimalKey(value: string | number | null, scale: number): string | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(scale) : String(value);
}

function mergeKey(item: MergeableOrderItem): string {
  return JSON.stringify([
    item.productId,
    item.productName,
    item.unitName,
    decimalKey(item.unitMultiplier, 4),
    item.sourceSku,
    item.priceBookId,
    item.priceBookName,
    decimalKey(item.unitPrice, 2),
    decimalKey(item.preDiscountUnitPrice, 2),
    item.lineDiscountMode,
    decimalKey(item.lineDiscountValue, 2),
    item.note,
    item.taxActivityId,
    item.taxActivityName,
    decimalKey(item.vatRevenueRate, 2),
    decimalKey(item.pitRevenueRate, 2),
  ]);
}

/** Combine only lines with identical product, unit, price, discount and tax snapshots. */
export function mergeEquivalentOrderItems<T extends MergeableOrderItem>(
  items: readonly T[],
  protectedItemIds: ReadonlySet<string> = new Set(),
): MergedItem<T>[] {
  const groups: ItemGroup<T>[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = JSON.stringify([
      mergeKey(item),
      protectedItemIds.has(item.id) ? item.id : null,
    ]);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        item,
        sourceItemIds: [item.id],
        quantity: Number(item.quantity),
        discount: Number(item.discount),
        total: Number(item.total),
      });
      continue;
    }

    const group = groups[existingIndex];
    group.sourceItemIds.push(item.id);
    group.quantity += Number(item.quantity);
    group.discount += Number(item.discount);
    group.total += Number(item.total);
  }

  return groups.map((group, lineOrder) => ({
    item: {
      ...group.item,
      quantity: group.quantity.toFixed(4),
      discount: group.discount.toFixed(2),
      total: group.total.toFixed(2),
      lineOrder,
    },
    sourceItemIds: group.sourceItemIds,
  }));
}

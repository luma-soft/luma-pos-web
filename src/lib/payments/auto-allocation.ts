export type OpenPaymentItem = {
  id: string;
  createdAt: string | Date;
  remaining: number;
};

const money = (value: number) => Math.round(value * 100) / 100;

/** Allocate a payment by document age while preserving display order. */
export function autoAllocatePayment<T extends OpenPaymentItem>(
  amount: number,
  items: T[],
  priority: "oldest" | "newest" = "oldest",
) {
  let left = Math.max(0, money(amount));
  const allocated = new Map<string, number>();
  const oldestFirst = [...items].sort((a, b) => {
    const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    const ordered = byDate || a.id.localeCompare(b.id);
    return priority === "oldest" ? ordered : -ordered;
  });
  for (const item of oldestFirst) {
    if (left <= 0) break;
    const value = money(Math.min(left, Math.max(0, item.remaining)));
    if (value > 0) allocated.set(item.id, value);
    left = money(left - value);
  }
  return items.map((item) => ({ id: item.id, amount: allocated.get(item.id) ?? 0 }));
}

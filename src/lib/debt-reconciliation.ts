export type DebtDocumentBalance = {
  id: string;
  createdAt: string | Date;
  remaining: number;
};

const money = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;

/**
 * Project a partner's net balance onto open documents. Unlinked historical
 * credits are applied to the oldest open documents first; callers retain their
 * own display and payment-allocation order.
 */
export function reconcileDebtDocuments<T extends DebtDocumentBalance>(documents: T[], currentDebt: number): T[] {
  const remainingById = new Map(documents.map((document) => [document.id, money(Math.max(0, document.remaining))]));
  const documentDebt = money([...remainingById.values()].reduce((sum, remaining) => sum + remaining, 0));
  let creditToApply = money(Math.min(documentDebt, Math.max(0, documentDebt - money(currentDebt))));
  const oldestFirst = [...documents].sort((left, right) => {
    const byDate = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return byDate || left.id.localeCompare(right.id);
  });

  for (const document of oldestFirst) {
    if (creditToApply <= 0) break;
    const remaining = remainingById.get(document.id) ?? 0;
    const offset = Math.min(remaining, creditToApply);
    remainingById.set(document.id, money(remaining - offset));
    creditToApply = money(creditToApply - offset);
  }

  return documents.map((document) => ({
    ...document,
    remaining: remainingById.get(document.id) ?? 0,
  }));
}

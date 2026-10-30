import { expect, test } from "bun:test";
import { reconcileDebtDocuments } from "./debt-reconciliation";

const balances = [520000, 20000, 362000, 140000, 385000, 545000];

test("applies a lower customer balance to the oldest invoices before showing payable balances", () => {
  const documents = balances.map((remaining, index) => ({
    id: `invoice-${index + 1}`,
    createdAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    remaining,
  }));

  expect(reconcileDebtDocuments(documents, 545000).map(({ id, remaining }) => ({ id, remaining })))
    .toEqual(documents.map(({ id }, index) => ({ id, remaining: index === 5 ? 545000 : 0 })));
});

test("keeps newest supplier documents open after historical credits offset older purchases", () => {
  const documents = balances.map((remaining, index) => ({
    id: `purchase-${index + 1}`,
    createdAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    remaining,
  })).reverse();

  expect(reconcileDebtDocuments(documents, 545000).filter(({ remaining }) => remaining > 0))
    .toEqual([{ id: "purchase-6", createdAt: "2026-09-06T00:00:00Z", remaining: 545000 }]);
});

test("does not change document balances when aggregate debt is higher than open invoices", () => {
  const documents = [{ id: "invoice-1", createdAt: "2026-09-01T00:00:00Z", remaining: 50 }];
  expect(reconcileDebtDocuments(documents, 100)).toEqual(documents);
});

test("a zero or negative aggregate balance clears all projected document balances", () => {
  const documents = [{ id: "invoice-1", createdAt: "2026-09-01T00:00:00Z", remaining: 50 }];
  expect(reconcileDebtDocuments(documents, 0)[0]?.remaining).toBe(0);
  expect(reconcileDebtDocuments(documents, -25)[0]?.remaining).toBe(0);
});

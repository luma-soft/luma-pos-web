import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const purchase = readFileSync(new URL("./purchases-table.tsx", import.meta.url), "utf8");
const returns = readFileSync(new URL("./purchase-returns-table.tsx", import.meta.url), "utf8");
test("mobile purchase row matches supplier-first native pattern and preserves modal", () => {
  expect(purchase).toContain("purchase.items.length");
  expect(purchase).toContain("purchaseOwed(purchase)");
  expect(purchase).toContain("onClick={() => setSelectedPurchaseId(purchase.id)}");
  expect(purchase).toContain("<PurchaseDetailModal");
});
test("mobile supplier return row preserves detail and refunds", () => {
  expect(returns).toContain("row.items.length");
  expect(returns).toContain("Number(row.totalRefund)");
  expect(returns).toContain("row.settlementStatus");
  expect(returns).toContain("onClick={toggle}");
  expect(returns).toContain("renderDetail={(row) => ");
});

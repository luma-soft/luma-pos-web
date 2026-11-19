import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const purchase = readFileSync(new URL("./purchases-table.tsx", import.meta.url), "utf8");
const returns = readFileSync(new URL("./purchase-returns-table.tsx", import.meta.url), "utf8");
const returnMobile = readFileSync(new URL("./purchase-return-mobile.tsx", import.meta.url), "utf8");
test("mobile purchase row matches supplier-first native pattern and preserves modal", () => {
  expect(purchase).toContain("purchase.items.length");
  expect(purchase).toContain("purchaseOwed(purchase)");
  // NativePurchaseReceiptRowView: the whole row opens the receipt.
  expect(purchase).toContain("onOpen={() => setSelectedPurchaseId(purchase.id)}");
  expect(purchase).toContain("<PurchaseDetailModal");
});
test("mobile supplier return row preserves detail and refunds", () => {
  // NativePurchaseReturnRowView on phones, pushing PurchaseReturnDetailView.
  expect(returnMobile).toContain("row.items.length");
  expect(returnMobile).toContain("Number(row.totalRefund)");
  expect(returnMobile).toContain("row.settlementStatus");
  expect(returns).toContain("onOpen={() => setOpenId(row.id)}");
  expect(returns).toContain("<MobilePurchaseReturnDetail");
  // Desktop keeps the expandable detail.
  expect(returns).toContain("renderDetail={(row) => ");
});

import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const purchase = readSource("./purchases-table.tsx", import.meta.url);
const returns = readSource("./purchase-returns-table.tsx", import.meta.url);
const returnMobile = readSource("./purchase-return-mobile.tsx", import.meta.url);
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

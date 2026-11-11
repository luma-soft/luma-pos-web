import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("editing a purchase receipt is blocked by completed supplier returns at the transaction boundary", () => {
  const purchases = source("./purchases.ts");
  const returns = source("./purchase-returns.ts");
  const inventory = source("../data/inventory.ts");
  const api = source("../../app/api/mobile/inventory/purchases/[id]/route.ts");

  expect(purchases).toContain('if (existingReturn) throw new Error("HAS_RETURNS")');
  expect(purchases).toContain('eq(purchaseReturns.purchaseOrderId, po.id)');
  expect(purchases).toContain('eq(purchaseReturns.status, "completed")');
  expect(purchases).toContain('HAS_RETURNS: "purchases.errors.hasReturns"');
  expect(returns).toContain('.limit(1).for("update")');
  expect(inventory).toContain("receiptHasCompletedReturn");
  expect(api).toContain("canEdit: !purchase.hasReturns");
  expect(api).toContain("hasReturns: purchase.hasReturns");
});

test("web edit controls explain why returned documents cannot be edited", () => {
  const purchase = source("../../app/(app)/inventory/tabs/purchase-detail-modal.tsx");
  const order = source("../../app/(app)/orders/[id]/order-detail-panel.tsx");
  const tooltip = source("../../components/disabled-edit-tooltip.tsx");
  const purchasePage = source("../../app/(app)/purchases/[id]/edit/page.tsx");

  expect(purchase).toContain('reason={t("purchases.errors.hasReturns")}');
  expect(order).toContain('reason={t("orderEdit.errors.hasReturns")}');
  expect(tooltip).toContain("disabled");
  expect(tooltip).toContain('role="tooltip"');
  expect(purchasePage).toContain("purchase.hasReturns");
});

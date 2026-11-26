import { expect, test } from "bun:test";
import { readSource } from "../../../../test-support/read-source.mjs";

const source = (path) => readSource(path, import.meta.url);

test("web edit controls explain why returned documents cannot be edited", () => {
  const purchase = source("./purchase-detail-modal.tsx");
  const order = source("../../orders/[id]/order-detail-panel.tsx");
  const tooltip = source("../../../../components/disabled-edit-tooltip.tsx");
  const purchasePage = source("../../purchases/[id]/edit/page.tsx");

  expect(purchase).toContain('reason={t("purchases.errors.hasReturns")}');
  expect(order).toContain('reason={t("orderEdit.errors.hasReturns")}');
  expect(tooltip).toContain("disabled");
  expect(tooltip).toContain('role="tooltip"');
  expect(purchasePage).toContain("purchase.hasReturns");
});

test("bulk delete shows the products the backend could not delete", () => {
  expect(source("./product-selection.tsx")).toContain("result.data.failures");
});

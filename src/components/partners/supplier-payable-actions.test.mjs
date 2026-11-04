import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./supplier-payable-actions.tsx", import.meta.url), "utf8");

test("successful supplier payment closes before refreshing the detail", () => {
  const paymentDialog = source.slice(
    source.indexOf("function SupplierPaymentDialog"),
    source.indexOf("function SupplierAdjustmentDialog"),
  );

  expect(paymentDialog.indexOf("onClose();")).toBeGreaterThan(-1);
  expect(paymentDialog.indexOf("onClose();")).toBeLessThan(paymentDialog.indexOf("onChanged();"));
  expect(paymentDialog).not.toContain("await onChanged();");
});

test("successful supplier debt adjustment closes before refreshing the detail", () => {
  const adjustmentDialog = source.slice(source.indexOf("function SupplierAdjustmentDialog"));

  expect(adjustmentDialog.indexOf("onClose();")).toBeGreaterThan(-1);
  expect(adjustmentDialog.indexOf("onClose();")).toBeLessThan(adjustmentDialog.indexOf("onChanged();"));
  expect(adjustmentDialog).not.toContain("await onChanged();");
});

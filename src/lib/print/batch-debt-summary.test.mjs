import { expect, test } from "bun:test";
import { buildBatchDebtSummaries } from "./batch-debt-summary";

const invoice = (overrides = {}) => ({
  id: "order-1",
  code: "HD001",
  status: "completed",
  customerId: "customer-1",
  customerName: "Công ty An Phát",
  createdAt: "2026-09-10T08:00:00.000Z",
  total: 1_000_000,
  paid: 700_000,
  currentCustomerDebt: 700_000,
  ...overrides,
});

test("summarizes debt only when a customer has at least two completed invoices", () => {
  const result = buildBatchDebtSummaries([
    invoice(),
    invoice({ id: "order-2", code: "HD002", total: 600_000, paid: 400_000 }),
  ]);

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    customerId: "customer-1",
    customerName: "Công ty An Phát",
    openingDebt: 200_000,
    batchTotal: 1_600_000,
    batchPaid: 1_100_000,
    batchRemaining: 500_000,
    currentDebt: 700_000,
  });
  expect(result[0].invoices.map((item) => item.code)).toEqual(["HD001", "HD002"]);
});

test("does not group walk-in, cancelled, draft, or single-customer invoices", () => {
  const result = buildBatchDebtSummaries([
    invoice({ customerId: null, customerName: "Khách lẻ" }),
    invoice({ id: "order-2", status: "cancelled" }),
    invoice({ id: "order-3", status: "draft" }),
    invoice({ id: "order-4", customerId: "customer-2", customerName: "Khách B" }),
  ]);

  expect(result).toEqual([]);
});

test("keeps separate customers and supports credit balances", () => {
  const result = buildBatchDebtSummaries([
    invoice({ currentCustomerDebt: -50_000, total: 200_000, paid: 200_000 }),
    invoice({ id: "order-2", code: "HD002", currentCustomerDebt: -50_000, total: 100_000, paid: 100_000 }),
    invoice({ id: "order-3", code: "HD003", customerId: "customer-2", customerName: "Khách B", currentCustomerDebt: 300_000 }),
    invoice({ id: "order-4", code: "HD004", customerId: "customer-2", customerName: "Khách B", currentCustomerDebt: 300_000 }),
  ]);

  expect(result).toHaveLength(2);
  expect(result[0].openingDebt).toBe(-50_000);
  expect(result[1].customerName).toBe("Khách B");
});

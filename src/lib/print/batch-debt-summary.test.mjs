import { expect, test } from "bun:test";
import { buildBatchDebtSummaries } from "./batch-debt-summary";

const invoice = (overrides = {}) => ({
  id: "order-1",
  code: "HD001",
  status: "completed",
  customerId: "customer-1",
  customerName: "Công ty An Phát",
  customerPhone: "0900000000",
  createdAt: "2026-09-10T08:00:00.000Z",
  total: 1_000_000,
  paid: 700_000,
  currentCustomerDebt: 700_000,
  ...overrides,
});

const entry = (overrides = {}) => ({
  id: "e",
  kind: "sale",
  code: "X",
  orderId: null,
  createdAt: "2026-09-12T08:00:00.000Z",
  typeLabel: "Bán hàng",
  value: 0,
  ...overrides,
});

test("without a ledger, only the selected invoices move the balance", () => {
  const [summary] = buildBatchDebtSummaries([
    invoice({ id: "order-2", code: "HD002", createdAt: "2026-09-11T08:00:00.000Z", total: 600_000, paid: 400_000 }),
    invoice(),
  ]);

  expect(summary).toMatchObject({
    customerId: "customer-1",
    customerPhone: "0900000000",
    periodStart: "2026-09-10T08:00:00.000Z",
    invoiceTotal: 1_600_000,
    invoicePaid: 1_100_000,
    invoiceRemaining: 500_000,
    openingDebt: 200_000,
    increases: 1_600_000,
    decreases: 1_100_000,
    currentDebt: 700_000,
    movements: [],
  });
  expect(summary.invoices.map((item) => item.code)).toEqual(["HD001", "HD002"]);
});

test("with a ledger, the statement counts every in-period movement and still balances", () => {
  const ledger = [
    entry({ id: "old", orderId: "old-order", code: "HD000", createdAt: "2026-08-01T00:00:00.000Z", value: 5_000_000 }),
    entry({ id: "s1", orderId: "order-1", code: "HD001", createdAt: "2026-09-10T08:00:00.000Z", value: 1_000_000 }),
    entry({ id: "p1", kind: "payment", orderId: "order-1", code: "TT-HD001", createdAt: "2026-09-10T09:00:00.000Z", typeLabel: "Thanh toán", value: -700_000 }),
    entry({ id: "s2", orderId: "order-2", code: "HD002", createdAt: "2026-09-11T08:00:00.000Z", value: 600_000 }),
    entry({ id: "adj", kind: "adjustment", code: "DCN1", createdAt: "2026-09-12T08:00:00.000Z", typeLabel: "Điều chỉnh công nợ", value: 300_000 }),
    entry({ id: "r1", kind: "payment", code: "PTN1", receiptId: "rc", receiptStatus: "cancelled", value: -50_000 }),
    entry({ id: "r1c", kind: "payment_cancellation", code: "Hủy PTN1", receiptId: "rc", receiptStatus: "cancelled", value: 50_000 }),
  ];
  const [summary] = buildBatchDebtSummaries(
    [invoice({ paid: 700_000, currentCustomerDebt: 6_200_000 }), invoice({ id: "order-2", code: "HD002", createdAt: "2026-09-11T08:00:00.000Z", total: 600_000, paid: 0, currentCustomerDebt: 6_200_000 })],
    new Map([["customer-1", ledger]]),
  );

  expect(summary.increases).toBe(1_900_000);
  expect(summary.decreases).toBe(700_000);
  expect(summary.openingDebt).toBe(5_000_000);
  expect(summary.openingDebt + summary.increases - summary.decreases).toBe(summary.currentDebt);
  expect(summary.movements.map((movement) => movement.code)).toEqual(["TT-HD001", "DCN1"]);
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

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const mobile = source.slice(source.indexOf('<div className="min-h-full bg-canvas lg:hidden">'), source.indexOf('<div className="hidden space-y-5'));
const desktop = source.slice(source.indexOf('<div className="hidden space-y-5'));
test("mobile recent sales match the two-row native presentation", () => {
  expect(mobile).toContain("data.recentOrders.slice(0, 2)");
  expect(mobile).toContain("order.customerName || t");
  expect(mobile).toContain("order.code");
  expect(mobile).toContain("formatDate(order.createdAt)");
  expect(mobile).toContain("<OrderStatusBadge");
  expect(mobile).toContain("<PaymentStatusBadge");
  expect(desktop).not.toContain("recentOrders.slice(0, 2)");
});

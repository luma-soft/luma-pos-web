import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const orders = readFileSync(new URL("./orders-table.tsx", import.meta.url), "utf8");
const sales = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../../inventory/page.tsx", import.meta.url), "utf8");
const groupTabs = readFileSync(new URL("../../../../components/group-tabs.tsx", import.meta.url), "utf8");
const row = orders.slice(orders.indexOf("export function OrderMobileRow("), orders.indexOf("export function OrdersTable("));

test("native-style order row retains separate select and full-row open targets", () => {
  expect(row).toContain("<OrderSelectionCheckbox");
  expect(row).toContain("disabled={!selectable}");
  expect(row).toContain("onClick={onOpen}");
  expect(row).toContain('className="absolute inset-0');
  expect(row).toContain('openInCurrentTab');
});

test("mobile order rows show customer/amount, status, payment and document metadata", () => {
  expect(row).toContain('name={customerTitle}');
  expect(row).toContain('formatCurrency(Number(order.total))');
  expect(row).toContain("<OrderStatusBadge");
  expect(row).toContain("<PaymentStatusBadge");
  expect(row).toContain("formatDate(order.createdAt)");
  expect(row).toContain("{order.code}");
});

test("native section tabs only opted in on invoice screens", () => {
  expect(sales).toContain("nativeMobileStyle");
  expect(groupTabs).toContain("nativeMobileStyle = false");
  expect(groupTabs).toContain("lg:border-b-0");
  expect(inventory).toContain("lg:flex lg:min-h-13");
});

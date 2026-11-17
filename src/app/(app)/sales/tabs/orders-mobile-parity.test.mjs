import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const orders = readFileSync(new URL("./orders-table.tsx", import.meta.url), "utf8");
const sales = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../../inventory/page.tsx", import.meta.url), "utf8");
const groupTabs = readFileSync(new URL("../../../../components/group-tabs.tsx", import.meta.url), "utf8");
const row = orders.slice(orders.indexOf("export function OrderMobileRow("), orders.indexOf("export function OrdersTable("));

test("native-style order row enters selection by long press and keeps a full-row open target", () => {
  expect(row).toContain("onLongPress={selectable ? onLongPress : undefined}");
  expect(row).toContain("onOpen={selecting ? onToggle : onOpen}");
  expect(row).toContain("disabled={!selectable}");
  expect(row).toContain("openInCurrentTab");
  expect(orders).toContain('mobileSelecting ? "flex" : "hidden lg:flex"');
});

test("mobile order rows show customer/amount, native status line, item summary and timestamp", () => {
  expect(row).toContain("name={customerTitle}");
  expect(row).toContain("formatCurrency(Number(order.total))");
  expect(row).toContain("status={labels.status}");
  expect(row).toContain("details={labels.itemSummary}");
  expect(row).toContain("createdAt={timestamp}");
  expect(row).toContain("code={order.code}");
  expect(orders).toContain("orderMobileStatusKey(order.status, order.paymentStatus)");
});

test("native section tabs only opted in on invoice screens", () => {
  expect(sales).toContain("nativeMobileStyle");
  expect(groupTabs).toContain("nativeMobileStyle = false");
  expect(groupTabs).toContain("lg:border-b-0");
  expect(inventory).toContain("lg:flex lg:min-h-13");
});

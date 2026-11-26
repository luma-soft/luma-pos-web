import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";

const orders = readSource("./orders-table.tsx", import.meta.url);
const sales = readSource("../page.tsx", import.meta.url);
const inventory = readSource("../../inventory/page.tsx", import.meta.url);
const groupTabs = readSource("../../../../components/group-tabs.tsx", import.meta.url);
const row = orders.slice(orders.indexOf("export function OrderMobileRow("), orders.indexOf("export function OrdersTable("));

test("native-style order row enters selection by long press and keeps a full-row open target", () => {
  expect(row).toContain("onLongPress={selectable ? onLongPress : undefined}");
  expect(row).toContain("onOpen={selecting ? onToggle : onOpen}");
  expect(row).toContain("disabled={!selectable}");
  expect(row).toContain("openInCurrentTab");
  // Phones: iOS batch footer ("Đã chọn N" · select all, Cancel + Actions sheet) and "+" → "Xong".
  expect(orders).toContain('"hidden w-full flex-wrap items-center justify-end gap-2 text-sm lg:flex"');
  expect(orders).toContain("<OrderMobileBatchFooter");
  expect(orders).toContain('useListPrimaryActionOverride(selecting ? t("mobile.invoices.selectDone") : null, exitSelection)');
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

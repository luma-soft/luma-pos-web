import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ORDER_TIME_PRESETS,
  isOrderDateRangeValid,
  resolveOrderTimePreset,
} from "../src/lib/orders/filter-date-range";

describe("orders filter drawer", () => {
  test("renders order and payment statuses as dropdowns with complete options", () => {
    const source = readFileSync(
      new URL(
        "../src/app/(app)/sales/tabs/orders-filter-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain('<SelectSection\n                  title="Trạng thái đơn"');
    expect(source).toContain(
      '<SelectSection\n                  title="Trạng thái thanh toán"',
    );
    expect(source).toContain("<select");
    expect(source).toContain("name={name}");
    for (const label of [
      "Nháp",
      "Đặt hàng",
      "Đang giao",
      "Hoàn tất",
      "Còn nợ",
      "Đã trả hàng",
      "Đã hủy",
      "Đã thanh toán",
      "Thanh toán một phần",
      "Chưa thanh toán",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).not.toContain("Đã hoàn tiền");
  });

  test("selects exact customers and products instead of submitting free text", () => {
    const drawerSource = readFileSync(
      new URL(
        "../src/app/(app)/sales/tabs/orders-filter-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const tabSource = readFileSync(
      new URL("../src/app/(app)/sales/tabs/orders.tsx", import.meta.url),
      "utf8",
    );
    const dataSource = readFileSync(
      new URL("../src/lib/data/orders.ts", import.meta.url),
      "utf8",
    );

    expect(drawerSource).toContain('name="customerId"');
    expect(drawerSource).toContain('name="productId"');
    expect(drawerSource).toContain('endpoint="/api/mobile/customers"');
    expect(drawerSource).toContain('endpoint="/api/mobile/pos/search"');
    expect(drawerSource).not.toContain('name="customerQuery"');
    expect(drawerSource).not.toContain('name="productQuery"');

    expect(tabSource).toContain("customerId: params.customerId");
    expect(tabSource).toContain("productId: params.productId");
    expect(dataSource).toContain("eq(orders.customerId, filters.customerId)");
    expect(dataSource).toContain("eq(orderItems.productId, filters.productId)");
  });

  test("matches the mobile time presets and date boundaries", () => {
    const now = new Date(2026, 7, 6, 12);

    expect(resolveOrderTimePreset("all", now)).toEqual({ from: "", to: "" });
    expect(resolveOrderTimePreset("today", now)).toEqual({
      from: "2026-08-06",
      to: "2026-08-06",
    });
    expect(resolveOrderTimePreset("yesterday", now)).toEqual({
      from: "2026-08-05",
      to: "2026-08-05",
    });
    expect(resolveOrderTimePreset("7days", now)).toEqual({
      from: "2026-07-31",
      to: "2026-08-06",
    });
    expect(resolveOrderTimePreset("30days", now)).toEqual({
      from: "2026-07-08",
      to: "2026-08-06",
    });
    expect(resolveOrderTimePreset("thisWeek", now)).toEqual({
      from: "2026-08-03",
      to: "2026-08-06",
    });
    expect(resolveOrderTimePreset("lastWeek", now)).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    });
    expect(resolveOrderTimePreset("thisMonth", now)).toEqual({
      from: "2026-08-01",
      to: "2026-08-06",
    });
    expect(resolveOrderTimePreset("lastMonth", now)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(resolveOrderTimePreset("thisYear", now)).toEqual({
      from: "2026-01-01",
      to: "2026-08-06",
    });
    expect(resolveOrderTimePreset("lastYear", now)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });

    expect(isOrderDateRangeValid("2025-02-28", "2026-02-28")).toBe(true);
    expect(isOrderDateRangeValid("2025-02-28", "2026-03-01")).toBe(false);
    expect(isOrderDateRangeValid("2026-08-06", "2026-08-05")).toBe(false);
  });

  test("renders the mobile time preset dropdown instead of quick-range chips", () => {
    const source = readFileSync(
      new URL(
        "../src/app/(app)/sales/tabs/orders-filter-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain('name="timePreset"');
    expect(ORDER_TIME_PRESETS.map((preset) => preset.label)).toEqual([
      "Toàn thời gian",
      "Hôm nay",
      "Hôm qua",
      "7 ngày gần đây",
      "30 ngày gần đây",
      "Tuần này",
      "Tuần trước",
      "Tháng này",
      "Tháng trước",
      "Năm nay",
      "Năm trước",
      "Tùy chỉnh",
    ]);
    expect(source).not.toContain("<QuickRange");
  });
});

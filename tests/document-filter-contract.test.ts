import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parseOrderListSearchParams,
} from "../src/lib/orders/list-filter-schema";
import {
  BOOKING_DELIVERY_PRESETS,
  DEFAULT_TIME_FILTER_PRESET,
  resolveBookingDeliveryPreset,
  resolveOrderTimePreset,
} from "../src/lib/orders/filter-date-range";
import {
  parseReturnListSearchParams,
  returnReasonLabels,
} from "../src/lib/returns/list-filter-schema";

const customerId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000003";

describe("document filter query contract", () => {
  test("validates and preserves every order query parameter", () => {
    const params = new URLSearchParams({
      documentType: "booking",
      q: "DH-01",
      customerId,
      productId,
      projectId,
      projectQuery: "Times City",
      status: "cancelled",
      payment: "partial",
      paymentMethod: "bank_transfer",
      source: "pos",
      from: "2026-01-01",
      to: "2026-08-06",
      deliveryTo: "2026-08-05",
      minTotal: "100000",
      maxTotal: "900000",
      includeCancelled: "1",
      page: "3",
      pageSize: "30",
    });
    const result = parseOrderListSearchParams(params);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      documentType: "booking",
      q: "DH-01",
      customerId,
      productId,
      projectId,
      projectQuery: "Times City",
      status: "cancelled",
      payment: "partial",
      paymentMethod: "bank_transfer",
      source: "pos",
      deliveryTo: "2026-08-05",
      minTotal: 100000,
      maxTotal: 900000,
      includeCancelled: true,
      page: 3,
      pageSize: 30,
    });
  });

  test("rejects invalid enums, dates, and inverted amount ranges", () => {
    expect(parseOrderListSearchParams(new URLSearchParams({ status: "done" })).success).toBe(false);
    expect(parseOrderListSearchParams(new URLSearchParams({ from: "2026-13-01", to: "2026-12-01" })).success).toBe(false);
    expect(parseOrderListSearchParams(new URLSearchParams({ from: "2025-01-01", to: "2026-01-02" })).success).toBe(false);
    expect(parseOrderListSearchParams(new URLSearchParams({ minTotal: "200", maxTotal: "100" })).success).toBe(false);
  });

  test("uses all time by default and supports one-sided overdue delivery", () => {
    const now = new Date(2026, 7, 6, 12);
    expect(DEFAULT_TIME_FILTER_PRESET).toBe("all");
    expect(resolveOrderTimePreset(DEFAULT_TIME_FILTER_PRESET, now)).toEqual({
      from: "",
      to: "",
    });
    expect(resolveBookingDeliveryPreset("overdue", now)).toEqual({
      from: "",
      to: "2026-08-05",
    });
    expect(BOOKING_DELIVERY_PRESETS.map((item) => item.label)).toContain("Quá hạn");
  });
});

describe("return filter query contract", () => {
  test("maps Vietnamese reason labels to canonical request codes", () => {
    expect(returnReasonLabels).toEqual({
      all: "Tất cả",
      defective: "Hàng lỗi",
      wrong_item: "Sai hàng",
      changed_mind: "Đổi ý",
      other: "Khác",
    });
    for (const code of ["defective", "wrong_item", "changed_mind", "other"]) {
      const result = parseReturnListSearchParams(new URLSearchParams({ reason: code }));
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.reason).toBe(code);
    }
    expect(parseReturnListSearchParams(new URLSearchParams({ reason: "Hàng lỗi" })).success).toBe(false);
  });

  test("validates return identifiers, dates, refund method and amount", () => {
    const valid = parseReturnListSearchParams(new URLSearchParams({
      q: "TH-01",
      customerId,
      productId,
      orderId: projectId,
      warehouseId: customerId,
      reason: "defective",
      refundMethod: "debt_deduct",
      from: "2026-08-01",
      to: "2026-08-06",
      minTotal: "0",
      maxTotal: "500000",
      includeCancelled: "true",
      page: "2",
      pageSize: "20",
    }));
    expect(valid.success).toBe(true);
    expect(parseReturnListSearchParams(new URLSearchParams({ refundMethod: "crypto" })).success).toBe(false);
    expect(parseReturnListSearchParams(new URLSearchParams({ minTotal: "9", maxTotal: "2" })).success).toBe(false);
  });
});

describe("document filter UI contract", () => {
  const drawer = readFileSync(
    new URL("../src/app/(app)/sales/tabs/document-filter-drawer.tsx", import.meta.url),
    "utf8",
  );
  const quotes = readFileSync(
    new URL("../src/app/(app)/sales/tabs/quotes.tsx", import.meta.url),
    "utf8",
  );
  const bookings = readFileSync(
    new URL("../src/app/(app)/sales/tabs/bookings.tsx", import.meta.url),
    "utf8",
  );

  test("uses one responsive drawer and custom opened pickers", () => {
    const shared = readFileSync(
      new URL(
        "../src/app/(app)/sales/tabs/filter-drawer-shared.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const haystack = `${drawer}\n${shared}`;
    expect(drawer).toContain('role="dialog"');
    expect(haystack).toContain('role="combobox"');
    expect(haystack).toContain('role="listbox"');
    expect(haystack).toContain('role="option"');
    expect(haystack).toContain('aria-expanded={open}');
    expect(haystack).toContain('event.key === "ArrowDown"');
    expect(haystack).toContain('document.addEventListener("mousedown", onOutsideClick)');
    expect(drawer).not.toContain("<select");
    expect(drawer).not.toContain("<datalist");
    expect(drawer).not.toContain('type="date"');
  });

  test("supports preview count, applies and clears without a numeric badge", () => {
    expect(drawer).not.toContain("countAppliedDocumentFilters");
    expect(drawer).not.toContain("điều kiện lọc");
    expect(drawer).toContain("/api/returns/count");
    expect(drawer).toContain("/api/orders/count");
    expect(drawer).toContain("Xóa lọc");
    expect(drawer).toContain('aria-live="polite"');
    expect(drawer).toContain("Xem ${count} ${labels.unit}");
  });

  test("resets pagination and shares getOrders for quote and booking lists", () => {
    expect(drawer).not.toContain('name="page"');
    expect(quotes).toContain("getOrders({");
    expect(quotes).toContain('documentType: "quote"');
    expect(bookings).toContain("getOrders({");
    expect(bookings).toContain('documentType: "booking"');
    expect(quotes).not.toContain("db.select");
    expect(bookings).not.toContain("db.select");
  });

  test("keeps access control on preview and option endpoints", () => {
    for (const path of [
      "../src/app/api/orders/count/route.ts",
      "../src/app/api/returns/count/route.ts",
      "../src/app/api/sales/filter-options/route.ts",
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toContain("requireSalesAccess");
    }
  });
});

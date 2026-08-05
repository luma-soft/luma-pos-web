import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
});

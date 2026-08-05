import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../messages/vi.json";
import { StockOverview } from "@/app/(app)/inventory/tabs/stock-overview";

function renderOverview() {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="vi"
      messages={viMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      <StockOverview
        totalValue={696_954_288}
        totalSkuCount={2_804}
        movementCount={100}
        statusCounts={{
          negativeStock: 1,
          outOfStock: 10,
          lowStock: 1,
          inStock: 2_792,
        }}
        movements={[
          {
            id: "f902b68e-0000-0000-0000-000000000000",
            type: "internal_use",
            quantity: -1,
            createdAt: "2026-08-04T05:27:00.000Z",
            productName: "Thiết bị chống sét lan truyền camera",
            baseUnit: "cái",
            warehouseName: "Kho chính",
            byName: "Nguyễn Văn A",
            note: null,
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

describe("inventory stock overview", () => {
  test("matches the approved two-metric and four-status information architecture", () => {
    const html = renderOverview();

    expect(html).toContain('data-layout="inventory-stock-overview"');
    expect(html).toContain("696.954.288");
    expect(html).toContain("100");
    expect(html).toContain("Âm kho");
    expect(html).toContain("Hết hàng");
    expect(html).toContain("Sắp hết");
    expect(html).toContain("Đủ hàng");
    expect(html).not.toContain('name="q"');
    expect(html).not.toContain("SKU đang bán");
  });

  test("keeps the overview summary compact on desktop", () => {
    const html = renderOverview();

    expect(html).toContain('data-density="compact"');
    expect(html).not.toContain("min-h-52");
    expect(html).not.toContain("min-h-32");
  });

  test.each([
    "negativeStock",
    "outOfStock",
    "lowStock",
    "inStock",
  ])("links the %s card to its dedicated detail state", (status) => {
    const html = renderOverview();
    expect(html).toContain(
      `href="/inventory?tab=stock&amp;stockStatus=${status}"`,
    );
  });

  test("renders recent stock history as a full-width table", () => {
    const html = renderOverview();

    expect(html).toContain('data-layout="inventory-history-table"');
    expect(html).toContain("Lịch sử kho gần đây");
    expect(html).toContain("Nguyễn Văn A");
  });
});

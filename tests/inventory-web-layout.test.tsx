import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../messages/vi.json";
import { InventoryNavigation } from "@/app/(app)/inventory/inventory-navigation";
import {
  RecentMovements,
  type MovementItem,
} from "@/app/(app)/inventory/tabs/stock-actions";

function renderWithMessages(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="vi"
      messages={viMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>,
  );
}

describe("inventory desktop layout", () => {
  test("shows every inventory section as a direct tab", () => {
    const html = renderWithMessages(<InventoryNavigation activeTab="stock" />);

    for (const tab of [
      "products",
      "purchases",
      "stock",
      "pricing",
      "purchase-returns",
      "internal",
    ]) {
      expect(html).toContain(`href="/inventory?tab=${tab}"`);
    }

    expect(html).not.toContain("common.more");
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain('href="/inventory?tab=stocktakes"');
  });

  test("caps the recent movement preview so it does not exceed the stock table", () => {
    const movements: MovementItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `movement-${index}`,
      type: "sale",
      quantity: -1,
      createdAt: "2026-08-04T05:27:00.000Z",
      productName: `Sản phẩm ${index + 1}`,
      baseUnit: "cái",
      warehouseName: "Kho chính",
      byName: null,
      note: null,
    }));

    const html = renderWithMessages(<RecentMovements movements={movements} />);

    expect(html).toContain("Sản phẩm 1");
    expect(html).toContain("max-h-[520px]");
    expect(html).toContain("overflow-auto");
  });
});

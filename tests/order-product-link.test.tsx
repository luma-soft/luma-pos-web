import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderProductLink } from "@/components/order-product-link";

describe("OrderProductLink", () => {
  test("opens the matching product in a new tab from an order line", () => {
    const markup = renderToStaticMarkup(
      <OrderProductLink productId="product-123" productName="EZVIZ H6C Pro 2K 3MP" />,
    );

    expect(markup).toContain('href="/inventory?tab=products&amp;expanded=product-123"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(">EZVIZ H6C Pro 2K 3MP</a>");
  });
});

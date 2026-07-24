import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderProductLink } from "@/components/order-product-link";

describe("OrderProductLink", () => {
  test("opens the matching product detail route from an order line", () => {
    const markup = renderToStaticMarkup(
      <OrderProductLink productId="product-123" productName="EZVIZ H6C Pro 2K 3MP" />,
    );

    expect(markup).toContain('href="/products/product-123"');
    expect(markup).not.toContain('target="_blank"');
    expect(markup).toContain(">EZVIZ H6C Pro 2K 3MP</a>");
  });
});

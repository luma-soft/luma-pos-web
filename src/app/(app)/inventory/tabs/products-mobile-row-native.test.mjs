import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";

const source = readSource("./products-table.tsx", import.meta.url);
const row = source.slice(source.indexOf("export function ProductMobileRow("), source.indexOf("function ProductGroupMobileButton("));

test("native mobile product rows keep image, product, price, stock and unit actions together", () => {
  // The tag is tinted by the native stock tone (NativeProductStockPresentation).
  expect(row).toContain("<ProductThumbnail product={product} largeOnMobile tone={stockTone} />");
  expect(row).toContain("mobile.products.stockOut");
  expect(row).toContain("productDisplayName(product");
  expect(row).toContain("retailDisplay");
  expect(row).toContain("stockDisplay");
  expect(row).toContain("mobile.inventory.onHand");
  expect(row).toContain("<ProductUnitSelector");
  expect(row).toContain("onChange={onUnitChange}");
});

test("unit control stays independent of the full-row open hit target; selection starts by long press", () => {
  expect(row).toContain("else onOpen();");
  expect(row).toContain("{...longPress.handlers}");
  expect(row).toContain('className="absolute inset-0');
  expect(row).toContain("pointer-events-auto relative z-10");
  expect(row).toContain("<MobileSelectionIndicator");
  expect(source).toContain("largeOnMobile = false");
  expect(source).toContain("const mobileSelection = selectionEnabled && mobileSelecting;");
});

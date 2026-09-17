import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./pos.ts", import.meta.url), "utf8");

test("mobile POS seed uses the same recent-sale ordering as web POS", () => {
  const mobileProjection = source.match(
    /export async function getMobilePosData[\s\S]*?return \{[\s\S]*?\n\}/,
  )?.[0];

  expect(mobileProjection).toBeDefined();
  expect(mobileProjection).toContain(
    'getPosData(storeId, { role, sort: "recent_sales" })',
  );
  expect(mobileProjection).not.toContain('sort: "created"');
});

test("document product browse uses the shared recent-sale ordering", () => {
  const policy = readFileSync(
    new URL("../pricing/pricing-policy.ts", import.meta.url),
    "utf8",
  );
  const browseRoute = readFileSync(
    new URL("../../app/api/mobile/products/browse/route.ts", import.meta.url),
    "utf8",
  );
  const catalog = readFileSync(new URL("./product-catalog.ts", import.meta.url), "utf8");

  expect(policy).toContain('"recent_sales"');
  expect(browseRoute).toContain("parsePricingSort");
    expect(catalog).toContain("sortByRecentProductSale");
});

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

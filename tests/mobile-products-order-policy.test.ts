import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/data/products.ts", "utf8");

describe("mobile product catalog order policy", () => {
  test("returns update timestamps and orders the catalog like pricing", () => {
    expect(source.match(/updatedAt: products\.updatedAt/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain(
      'filters.sort === "updated" ? desc(products.updatedAt) : asc(products.name)',
    );
  });
});

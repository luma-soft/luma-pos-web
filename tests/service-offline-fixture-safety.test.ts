import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "tests/service-offline-concurrency-postgres.test.mjs",
  "utf8",
);

describe("offline PostgreSQL concurrency fixture safety", () => {
  test("never runs against the application database", () => {
    expect(source).toContain("process.env.TEST_DATABASE_URL");
    expect(source).not.toContain("process.env.DATABASE_URL");
  });

  test("always removes its temporary product", () => {
    expect(source).toContain("let productId;");
    expect(source).toContain("productId = product.id;");
    expect(source).toContain(
      "if (productId) await db.delete(products).where(eq(products.id, productId));",
    );
  });
});

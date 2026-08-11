import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("AI tenant scope contract", () => {
  test("threads the authenticated store through tools and every database-backed preview", () => {
    const actions = read("src/lib/ai/actions.ts");
    const toolCatalog = read("src/lib/ai/tool-catalog.ts");
    const toolLoop = read("src/lib/ai/tool-loop.ts");

    expect(toolLoop).toContain("storeId: input.storeId");
    expect(toolCatalog).toContain("storeId: string;");
    for (const signature of [
      "draftPurchaseOrderPreview(storeId: string",
      "inboundPreview(storeId: string",
      "pricePreview(storeId: string",
      "productCommandPreview(storeId: string",
      "customerPreview(storeId: string",
      "reportSummaryPreview(storeId: string",
      "orderActionPreview(storeId: string",
      "posCartPreview(storeId: string",
    ]) {
      expect(actions).toContain(signature);
    }
  });

  test("scopes AI entity reads and no longer slices an arbitrary first 300 products", () => {
    const actions = read("src/lib/ai/actions.ts");
    const candidates = read("src/lib/ai/entity-candidates.ts");
    const toolCatalog = read("src/lib/ai/tool-catalog.ts");

    for (const table of ["suppliers", "warehouses", "priceBooks", "productPrices", "categories", "brands", "customers", "orders"]) {
      expect(actions).toContain(`eq(${table}.storeId, storeId)`);
    }
    for (const table of ["products", "productSuppliers", "productUnits"]) {
      expect(candidates).toContain(`eq(${table}.storeId, storeId)`);
    }
    for (const table of ["products", "suppliers", "customers", "warehouses"]) {
      expect(toolCatalog).toContain(`eq(${table}.storeId, storeId)`);
    }
    expect(actions).not.toContain(".limit(300)");
    expect(actions).not.toContain(".limit(3000)");
  });
});

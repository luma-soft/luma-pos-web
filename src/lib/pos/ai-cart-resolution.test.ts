import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { resolveAiCartDraftItems } from "./ai-cart-resolution";

const product = (id: string, sku: string, name: string) => ({
  id,
  sku,
  name,
  isVariantParent: false,
  children: [],
});

describe("AI cart product resolution", () => {
  test("loads an active product that is outside the initial POS catalog", async () => {
    const switchProduct = product("switch", "SP000929", "Hạt Pana công tắc");
    const bulb = product("bulb", "SP053199", "Bóng Trụ 3S - 40W");
    const queries: string[] = [];

    const result = await resolveAiCartDraftItems(
      [{ productId: bulb.id, productName: bulb.name, sku: bulb.sku, quantity: 1 }],
      [switchProduct],
      async (query) => {
        queries.push(query);
        return query === bulb.sku ? [bulb] : [];
      },
    );

    assert.deepEqual(queries, ["SP053199"]);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.matched, [{ product: bulb, quantity: 1 }]);
  });

  test("keeps genuinely unknown rows unresolved after the server lookup", async () => {
    const result = await resolveAiCartDraftItems(
      [{ productName: "Sản phẩm không tồn tại", quantity: 3 }],
      [],
      async () => [],
    );

    assert.deepEqual(result.matched, []);
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0]?.label, "Sản phẩm không tồn tại");
    assert.equal(result.unresolved[0]?.quantity, 3);
  });
});

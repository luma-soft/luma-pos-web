import assert from "node:assert/strict";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const {
  isPreviewApplicable,
  previewMatchedCount,
  previewUnresolvedCount,
  quickActionPrompt,
} = await import(`${PROJ}/src/components/ai-quick-actions/utils.ts`);

const purchasePrompt = quickActionPrompt({
  preset: "create_inventory_inbound",
  userText: "Nhập 2 LED9W",
  attachmentCount: 0,
  attachmentNames: [],
});

assert.match(purchasePrompt, /\[AI_ACTION_PRESET:create_inventory_inbound\]/);
assert.match(purchasePrompt, /không lưu, không cộng tồn kho/);

const posImagePrompt = quickActionPrompt({
  preset: "pos_image_cart_draft",
  userText: "",
  attachmentCount: 1,
  attachmentNames: ["order.jpg"],
});

assert.match(posImagePrompt, /\[AI_ACTION_PRESET:pos_image_cart_draft\]/);
assert.match(posImagePrompt, /\[1 attachment\(s\): order\.jpg\]/);
assert.match(posImagePrompt, /không tạo hóa đơn, không thanh toán/);

const preview = {
  intent: "pos_voice_cart_draft",
  action: {
    payload: {
      items: [{ productId: "p1", quantity: 2 }],
      unresolvedItems: [{ productName: "missing", quantity: 1 }],
    },
  },
};

assert.equal(previewMatchedCount(preview), 1);
assert.equal(previewUnresolvedCount(preview), 1);
assert.equal(isPreviewApplicable(preview, ["pos_voice_cart_draft"]), true);
assert.equal(isPreviewApplicable({ ...preview, action: { payload: { items: [] } } }, ["pos_voice_cart_draft"]), false);
assert.equal(isPreviewApplicable(preview, ["create_inventory_inbound"]), false);

console.log("ai quick action tests passed");

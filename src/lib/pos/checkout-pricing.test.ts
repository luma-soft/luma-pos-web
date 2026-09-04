import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildExpectedPosPricing, countPosPricingConflicts, requestPosOrder } from "./checkout-pricing";
import { buildPosOrderItemPayload } from "./order-item-payload";

const product = { id: "10000000-0000-4000-8000-000000000001", name: "Ống nhựa" };
const cart = [
  { product, unitName: "cây", unitMultiplier: 4, quantity: 2, unitPrice: 48000, manualPrice: false },
  { product, unitName: "m", unitMultiplier: 1, quantity: 3, unitPrice: 12345.67, manualPrice: true, lineDiscountMode: "pct" as const, lineDiscountValue: 20, lineDiscount: 2469.13 },
  { product, unitName: "cây", unitMultiplier: 4, quantity: 1, unitPrice: 0, manualPrice: true },
];

describe("POS checkout pricing consumer", () => {
  it("captures the displayed final per-unit prices in cart order, including repeated products, promotions, manual decimals and free lines", () => {
    const finalPrices = [43200, 9876.54, 0];
    const snapshot = buildExpectedPosPricing(cart, (line) => finalPrices[cart.indexOf(line)]);
    assert.deepEqual(snapshot, {
      version: 1,
      lines: [
        { productId: product.id, unitName: "cây", unitMultiplier: 4, unitPrice: 43200 },
        { productId: product.id, unitName: "m", unitMultiplier: 1, unitPrice: 9876.54 },
        { productId: product.id, unitName: "cây", unitMultiplier: 4, unitPrice: 0 },
      ],
    });
    assert.deepEqual(snapshot.lines.map((line) => [line.productId, line.unitName]), cart.map(buildPosOrderItemPayload).map((line) => [line.productId, line.unitName]));
    assert.equal(buildPosOrderItemPayload(cart[1]).manualUnitPrice, 12345.67);
    assert.equal(buildPosOrderItemPayload(cart[2]).manualUnitPrice, 0);
  });

  it("keeps a detached, serializable snapshot for offline replay instead of reading updated catalog prices", async () => {
    const mutableCart = structuredClone(cart);
    const payload = { items: mutableCart.map(buildPosOrderItemPayload), expectedPricing: buildExpectedPosPricing(mutableCart, (line) => line.unitPrice) };
    const queued = structuredClone(payload);
    mutableCart[0].unitPrice = 99999;
    mutableCart[0].unitMultiplier = 5;
    let calls = 0;
    const result = await requestPosOrder(queued, async (input) => {
      calls += 1;
      assert.deepEqual(input, payload);
      assert.equal(input.expectedPricing.lines[0].unitPrice, 48000);
      assert.equal(input.expectedPricing.lines[0].unitMultiplier, 4);
      return { ok: false, error: "pos.errors.pricingChanged" };
    });
    assert.deepEqual(result, { kind: "rejected", error: "pos.errors.pricingChanged" });
    assert.equal(calls, 1);
    assert.deepEqual(queued, payload);
  });

  it("does not classify a pricing rejection as a transport failure or retry it", async () => {
    const retainedCart = structuredClone(cart);
    let createCalls = 0;
    const result = await requestPosOrder({ expectedPricing: buildExpectedPosPricing(cart, (line) => line.unitPrice) }, async () => {
      createCalls += 1;
      return { ok: false, error: "pos.errors.pricingChanged" };
    });
    assert.equal(result.kind, "rejected");
    assert.equal(createCalls, 1);
    assert.deepEqual(cart, retainedCart);
  });

  it("only thrown transport failures enter offline fallback, while success retains its server identity", async () => {
    assert.deepEqual(await requestPosOrder({}, async () => { throw new TypeError("Failed to fetch"); }), { kind: "connection-failed" });
    assert.deepEqual(await requestPosOrder({}, async () => ({ ok: true, data: { id: "order", code: "DH001" } })), { kind: "created", data: { id: "order", code: "DH001" } });
  });

  it("legacy queued payloads remain accepted and failed pricing snapshots stay visible for attention", async () => {
    const legacy = { items: cart.map(buildPosOrderItemPayload) };
    await requestPosOrder(legacy, async (payload) => {
      assert.equal("expectedPricing" in payload, false);
      return { ok: true, data: null };
    });
    assert.equal(countPosPricingConflicts([
      { failed: true, failReason: "pos.errors.pricingChanged" },
      { failed: true, failReason: "errors.forbidden" },
      { failed: false, failReason: "pos.errors.pricingChanged" },
      { failed: true, failReason: "pos.errors.pricingChanged" },
    ]), 2);
  });

  it("all POS create/edit/copy modes share the snapshot and rejected submissions never close the cart or start payment", () => {
    const source = readFileSync(new URL("../../app/(pos)/pos/pos-client.tsx", import.meta.url), "utf8");
    const submit = source.slice(source.indexOf("async function submitOrder("), source.indexOf("async function submitReturn("));
    assert.match(submit, /expectedPricing: buildExpectedPosPricing\(cart, \(line\) => effPrice\(line\)\.price\)/);
    assert.match(submit, /source: orderSource/);
    assert.match(submit, /mode: submitMode/);
    const rejected = submit.slice(submit.indexOf('res.kind === "rejected"'), submit.indexOf('// mất mạng giữa chừng'));
    assert.match(rejected, /setPricingConflictId\(activeId\)/);
    assert.doesNotMatch(rejected, /closeInvoice|queueOffline|setSepayCheckout|fetch\(/);
    assert.match(source, /t\("pos.pricingConflict.refresh"\)/);
    assert.match(source, /setPricingConflicts\(countPosPricingConflicts\(remain\)\)/);
  });
});

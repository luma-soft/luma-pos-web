import assert from "node:assert/strict";
import test from "node:test";
import {
  canSwitchPosDraftKind,
  isSwitchablePosDraftKind,
  switchPosDraftKind,
} from "./draft-kind-switch";

test("only unsaved active invoice, quote, and booking drafts can switch kind", () => {
  assert.equal(isSwitchablePosDraftKind("invoice"), true);
  assert.equal(isSwitchablePosDraftKind("quote"), true);
  assert.equal(isSwitchablePosDraftKind("booking"), true);
  assert.equal(isSwitchablePosDraftKind("return_quick"), false);

  assert.equal(canSwitchPosDraftKind({
    kind: "invoice",
    hasSource: false,
    isCameraQuote: false,
    isHeld: false,
  }), true);
  assert.equal(canSwitchPosDraftKind({
    kind: "invoice",
    hasSource: true,
    isCameraQuote: false,
    isHeld: false,
  }), false);
  assert.equal(canSwitchPosDraftKind({
    kind: "quote",
    hasSource: false,
    isCameraQuote: true,
    isHeld: false,
  }), false);
  assert.equal(canSwitchPosDraftKind({
    kind: "booking",
    hasSource: false,
    isCameraQuote: false,
    isHeld: true,
  }), false);
});

test("switching a draft preserves cart data and clears invoice payment input", () => {
  for (const kind of ["quote", "booking"] as const) {
    const cart = [{ productId: "router", quantity: 2 }];
    const draft = {
      id: `draft-${kind}`,
      kind: "invoice",
      cart,
      payMethod: "bank_transfer" as const,
      paidInput: 1490000,
    };

    const switched = switchPosDraftKind(draft, kind);

    assert.equal(switched.kind, kind);
    assert.deepEqual(switched.cart, cart);
    assert.equal(switched.payMethod, "cash");
    assert.equal(switched.paidInput, null);
  }
});

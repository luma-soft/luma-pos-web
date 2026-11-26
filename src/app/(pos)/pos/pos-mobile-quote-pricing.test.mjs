import { readSource } from "../../../test-support/read-source.mjs";
import { test, expect } from "bun:test";
const source=readSource("./pos-client.tsx", import.meta.url);
const vi=JSON.parse(readSource("../../../../messages/vi.json", import.meta.url));
const en=JSON.parse(readSource("../../../../messages/en.json", import.meta.url));
test("quotation confirmation has a native-specific heading only on mobile",()=>{
  expect(source).toContain('t(isQuoteDraft ? "pos.quotePricingDetails" : "pos.paymentDetails")');
  const checkout=source.slice(source.indexOf("<PosMobileCheckout"));
  expect(checkout).toContain('heading: t(isQuoteDraft ? "pos.quotePricingDetails" : "pos.paymentDetails")');
  expect(readSource("../../../components/pos/pos-mobile-checkout.tsx", import.meta.url)).toContain('lg:hidden print:hidden');
  expect(source).toContain('onValueChange={setDiscountInput}');
  expect(source).toContain('onValueChange={setTaxRate}');
  expect(source).toContain('onValueChange={setShippingFee}');
});
test("native pricing copy is available in both locales",()=>{
  expect(vi.pos.quotePricingDetails).toBe("Chi tiết báo giá");
  expect(en.pos.quotePricingDetails).toBe("Quotation details");
  expect(vi.pos.paymentDetails).toBe("Chi tiết thanh toán");
  expect(en.pos.paymentDetails).toBe("Payment details");
});

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("./pos-client.tsx",import.meta.url),"utf8");
const vi=JSON.parse(readFileSync(new URL("../../../../messages/vi.json",import.meta.url),"utf8"));
const en=JSON.parse(readFileSync(new URL("../../../../messages/en.json",import.meta.url),"utf8"));
test("quotation confirmation has a native-specific heading only on mobile",()=>{
  expect(source).toContain('t(isQuoteDraft ? "pos.quotePricingDetails" : "pos.paymentDetails")');
  const checkout=source.slice(source.indexOf("<PosMobileCheckout"));
  expect(checkout).toContain('heading: t(isQuoteDraft ? "pos.quotePricingDetails" : "pos.paymentDetails")');
  expect(readFileSync(new URL("../../../components/pos/pos-mobile-checkout.tsx",import.meta.url),"utf8")).toContain('lg:hidden print:hidden');
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

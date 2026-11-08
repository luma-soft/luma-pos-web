import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("./pos-client.tsx",import.meta.url),"utf8");
const vi=JSON.parse(readFileSync(new URL("../../../../messages/vi.json",import.meta.url),"utf8"));
const en=JSON.parse(readFileSync(new URL("../../../../messages/en.json",import.meta.url),"utf8"));
test("quotation confirmation has a native-specific heading only on mobile",()=>{
  expect(source).toContain('t(isQuoteDraft ? "pos.quotePricingDetails" : "pos.paymentDetails")');
  expect(source).toContain('uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400 lg:hidden');
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

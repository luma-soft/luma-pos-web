import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const customer=readFileSync(new URL("./customer-create-dialog.tsx",import.meta.url),"utf8");
const supplier=readFileSync(new URL("./supplier-create-dialog.tsx",import.meta.url),"utf8");

test("customer and supplier creation dialogs fit the phone with desktop sizes preserved",()=>{
  for(const source of [customer,supplier]){
    expect(source).toContain("h-dvh w-full overflow-y-auto overscroll-contain");
    expect(source).toContain("safe-area-inset-top");
    expect(source).toContain("safe-area-inset-bottom");
    expect(source).toContain("lg:h-auto lg:max-h-[min(92dvh,760px)] lg:max-w-2xl");
    expect(source).toContain("sticky top-0 z-10");
    expect(source).toContain("lg:static lg:border-b-0");
    expect(source).toContain('aria-label={t("common.close")}');
  }
});
test("creation actions, validation and cancellation remain connected",()=>{
  expect(customer).toContain("zodResolver(createCustomerSchema)");
  expect(supplier).toContain("zodResolver(createSupplierSchema)");
  expect(customer).toContain("<CustomerCreateForm");
  expect(supplier).toContain("<SupplierCreateForm");
  for(const source of [customer,supplier]){
    expect(source).toContain("onCreated={onCreated}");
    expect(source).toContain('tx="common.save"');
    expect(source).toContain('tx="common.cancel"');
  }
});

test("mobile partner creation keeps submission controls visible on long forms",()=>{
  for(const source of [customer,supplier]){
    expect(source).toContain("mobileDialogActions = false");
    expect(source).toContain("sticky bottom-0 z-10");
    expect(source).toContain("lg:static lg:mx-0");
    expect(source).toContain("mobileDialogActions");
    expect(source).toContain('type="submit" loading={form.formState.isSubmitting}');
  }
});

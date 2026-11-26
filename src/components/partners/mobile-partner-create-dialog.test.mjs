import { readSource } from "../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const customer=readSource("./customer-create-dialog.tsx", import.meta.url);
const supplier=readSource("./supplier-create-dialog.tsx", import.meta.url);

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
  // Customers follow NativeCustomerEditorView: Save sits in the sticky iOS header.
  expect(customer).toContain("mobileDialogActions = false");
  expect(customer).toContain('formId="customer-create-form"');
  expect(customer).toContain('type="submit" loading={form.formState.isSubmitting}');
  // Suppliers follow NativeSupplierFormView the same way.
  expect(supplier).toContain("mobileDialogActions = false");
  expect(supplier).toContain("formId={formId}");
  expect(supplier).toContain('type="submit" loading={form.formState.isSubmitting}');
});

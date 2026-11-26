import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const customer = readSource("./customers-table.tsx", import.meta.url);
const supplier = readSource("./suppliers-table.tsx", import.meta.url);
const nav = readSource("../../../../components/group-tabs.tsx", import.meta.url);
test("partner rows have full touch areas and independent deep links", () => {
  // Phone rows are whole-row buttons (NativeCustomerRow / NativeSupplierItemRow) that push the profile.
  expect(customer).toContain("onOpen={() => openCustomer(customer)}");
  expect(supplier).toContain("onOpen={() => openSupplier(row)}");
});
test("segmented secondary navigation is opt-in", () => {
  expect(nav).toContain("mobileSegmented = false");
  expect(nav).toContain("lg:bg-transparent lg:p-0");
});

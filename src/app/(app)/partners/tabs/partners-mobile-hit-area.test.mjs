import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const customer = readFileSync(new URL("./customers-table.tsx", import.meta.url), "utf8");
const supplier = readFileSync(new URL("./suppliers-table.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../../../components/group-tabs.tsx", import.meta.url), "utf8");
test("partner rows have full touch areas and independent deep links", () => {
  expect(customer).toContain("onClick={() => openCustomer(customer)}");
  expect(supplier).toContain("onClick={() => openSupplier(row)}");
  expect(customer).toContain("pointer-events-auto relative z-10");
  expect(supplier).toContain("pointer-events-auto relative z-10");
});
test("segmented secondary navigation is opt-in", () => {
  expect(nav).toContain("mobileSegmented = false");
  expect(nav).toContain("lg:bg-transparent lg:p-0");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("legacy customer, supplier, order and purchase details redirect into list modals", () => {
  expect(source("./customers/[id]/page.tsx")).toContain("redirect(Routes.customerDetail(id))");
  expect(source("./suppliers/[id]/page.tsx")).toContain("redirect(Routes.supplierDetail(id))");
  expect(source("./orders/[id]/page.tsx")).toContain("redirect(Routes.salesOrder(order.id, order.status))");
  expect(source("./purchases/[id]/page.tsx")).toContain("redirect(Routes.purchaseDetail(id))");
});

test("hard-loaded project detail remains inside the project dialog", () => {
  const projectPage = source("./projects/[id]/page.tsx");
  expect(projectPage).toContain("<ProjectDetailDialog");
  expect(projectPage).toContain('presentation="modal"');
  expect(projectPage).not.toContain('presentation="page"');
});
